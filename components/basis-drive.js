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
  var NEAR_MI = 40;
  /* THE SWITCH for the second view's new drawing, the month in one band (components/basis-month.js). Off (Nov 13): the
     "Since Oct 12" button opens the history box as it has been (components/cb-basis-hist.js), and basis-month.js is
     never loaded. On only where a page sets window.BASIS_MONTH_V2 = true (no page does; its tests do). */
  var MONTH_V2 = typeof window !== 'undefined' && window.BASIS_MONTH_V2 === true;                       // the page's own nearby radius (build_cash_bid_pages.NEARBY_MI)
  var CROPS = [['corn', 'Corn', 'corn', 'is'], ['soybeans', 'Soybeans', 'soybean', 'are']];
  var FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
  // the page's colours are the site's tokens; the picture's are the kit card's (components/ag-chart.js card)
  /* The picture is drawn with classes (components/basis-drive.css gives them the site's colour tokens), every
     line of a kind in one path and every dot a round-capped point, so a town page carries it in a few KB. The saved
     picture is an image with no page around it: it carries its own colours (the kit card's) in a style block. */
  var CARD = { ink: '#e9edeb', mid: 'rgba(233,237,235,.66)', grid: 'rgba(132,160,168,.22)', rule: 'rgba(132,160,168,.45)', zone: '#14191b', gold: '#d4a23f', bg: '#0a0c0d' };
  function cardStyle(c) {
    return '<style>.e{text-anchor:end}.c{text-anchor:middle}text{fill:' + c.ink + '}.m{fill:' + c.mid + '}.g{fill:' + c.gold + '}.b{font-weight:700}.B{font-size:1.08em}.h{paint-order:stroke;stroke:' + c.bg + ';stroke-width:3px;stroke-linejoin:round}.z{fill:' + c.zone + '}' +
      '.gr,.ev,.ax,.md,.wk,.dr,.di,.dg,path{fill:none}.gr{stroke:' + c.grid + '}.ev,.ax{stroke:' + c.rule + '}.ev{stroke-width:1.4}.md{stroke:' + c.ink + ';stroke-width:1.2;stroke-dasharray:5 4}' +
      '.wk{stroke:' + c.mid + ';stroke-width:1.6}.ld{stroke:' + c.mid + ';stroke-width:1.2;stroke-dasharray:2 3}.dr,.di,.dg{stroke-linecap:round}.dr{stroke:' + c.bg + '}.di{stroke:' + c.ink + '}.dg{stroke:' + c.gold + '}</style>';
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
  /* A row whose delivery site names another town on the state's list ("Dunkerton Co-op | ADM Cedar Rapids Corn",
     pinned at Dunkerton) is a price paid at that town's plant, not at the elevator's pin: it is left off the picture and
     named under it (round 1: it was drawn 39 miles out and called out). Worked out once per table. */
  function elsewhere(doc, ix) {
    if (doc._at) return doc._at;
    var towns = (doc.towns || []).filter(function (t) { return String(t[1]).length >= 4; }).map(function (t) { return { name: t[1], low: String(t[1]).toLowerCase(), path: t[0], lat: t[2], lon: t[3] }; });
    var own = {}; (doc.towns || []).forEach(function (t) { own[t[0]] = String(t[1]).toLowerCase(); });
    doc._at = doc.rows.map(function (r) {
      var site = ' ' + String(r[ix.town] || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ', mine = own[r[ix.path]] || '', best = null;
      towns.forEach(function (t) {
        if (t.low === mine || mine.indexOf(t.low) >= 0 || t.low.indexOf(mine) >= 0 && mine) return;
        if (site.indexOf(' ' + t.low.replace(/[^a-z0-9]+/g, ' ') + ' ') < 0) return;
        if (typeof r[ix.lat] === 'number' && miles(r[ix.lat], r[ix.lon], t.lat, t.lon) > 80) return;
        if (!best || t.low.length > best.low.length) best = t;
      });
      return best ? best.name : '';
    });
    return doc._at;
  }
  function pick(docs, cfg, crop) {
    var rows = [], prev = '', townOf = {}, away = [];
    Object.keys(docs || {}).sort().forEach(function (st) {
      var doc = docs[st]; if (!doc || !doc.cols) return;
      var ix = {}; doc.cols.forEach(function (k, i) { ix[k] = i; });
      if (doc.prev && (!prev || doc.prev > prev)) prev = doc.prev;
      (doc.towns || []).forEach(function (t) { townOf[t[0]] = t[1]; });
      var at = ix.town != null ? elsewhere(doc, ix) : [];
      doc.rows.forEach(function (r, j) {
        if (r[ix.crop] !== crop || r[ix.relay]) return;
        var inTown = !!cfg.path && r[ix.path] === cfg.path, lat = r[ix.lat], lon = r[ix.lon];
        var d = typeof lat === 'number' && typeof lon === 'number' && cfg.ll ? miles(cfg.ll[0], cfg.ll[1], lat, lon) : null;
        if (!inTown && (d == null || d > NEAR_MI)) return;
        if (at[j]) { away.push({ elevator: r[ix.elevator], site: r[ix.town], at: at[j] }); return; }
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
    /* no neighbour on the town's own month, and several on another month against the same futures: those are drawn as
       open dots, named by their month (round 1: Columbia City's chart was empty beside 11 November bids) */
    var alt = [], altDm = '';
    if (ref && !on.some(function (r) { return !r.inTown; })) {
      var am = {}; ok.forEach(function (r) { if (!r.inTown && r.vs === ref.vs && r.dm && r.dm !== ref.dm) am[r.dm] = (am[r.dm] || 0) + 1; });
      altDm = Object.keys(am).sort(function (a, b) { return am[b] - am[a] || (a < b ? -1 : 1); })[0] || '';
      if (altDm && am[altDm] >= 2) { alt = ok.filter(function (r) { return !r.inTown && r.vs === ref.vs && r.dm === altDm; }).sort(function (a, b) { return a.mi - b.mi || b.c - a.c; }); alt.forEach(function (r) { r.alt = true; }); other = other.filter(function (r) { return alt.indexOf(r) < 0; }); }
      else altDm = '';
    }
    var town = on.filter(function (r) { return r.inTown; }).sort(function (a, b) { return b.c - a.c || (b.w || 0) - (a.w || 0) || (a.name < b.name ? -1 : 1); });
    var out = on.filter(function (r) { return !r.inTown; }).sort(function (a, b) { return a.mi - b.mi || b.c - a.c || (a.name < b.name ? -1 : 1); });
    var c = CROPS.filter(function (x) { return x[0] === crop; })[0] || [crop, crop, crop];
    return { crop: crop, Crop: c[1], adj: c[2], verb: c[3] || 'is', town: town, out: out, alt: alt, altDm: altDm, all: town.concat(out, alt), ref: ref, other: other, away: away, left: left, leftIn: bad.some(function (r) { return r.inTown; }),
             med: med && ref && med.label === ref.vs ? med : null, prev: prev };
  }
  /* A bid left off (another futures month) that pays more cash outside town than any drawn: the headline compares on
     cash, in town and out, and says so (round 1: Alburnett's $11.81 soybeans; round 2: Linn Co-op's $12.06 in town) */
  function cashLead(p) {
    if (!p.ref) return null;
    var oc = p.other.filter(function (r) { return !r.inTown && r.mi != null && r.vs && r.vs !== p.ref.vs; }).reduce(function (b, r) { return !b || r.cash > b.cash || (r.cash === b.cash && r.mi < b.mi) ? r : b; }, null);
    var maxO = p.out.reduce(function (m, r) { return Math.max(m, r.cash); }, -1);
    return oc && oc.cash > maxO + 0.004 ? oc : null;
  }
  /* the highest cash in town on any futures month (the drawn bids and those left off for another month) */
  function townCash(p) { return p.town.concat(p.other.filter(function (r) { return r.inTown; })).reduce(function (b, r) { return !b || r.cash > b.cash ? r : b; }, null); }
  /* the town's drawn bids as the month view's last day: { d, hi, lo, n, top } (d: the build's day in Central time) */
  function todayOf(p, d) {
    if (!p.town.length) return null;
    var hi = Math.max.apply(null, p.town.map(function (r) { return r.c; })), lo = Math.min.apply(null, p.town.map(function (r) { return r.c; }));
    return { d: d, hi: hi, lo: lo, n: p.town.length, top: p.town.filter(function (r) { return r.c === hi; }).map(function (r) { return r.name; }) };
  }
  /* a week's line is drawn only where the bid moved */
  function moved(p) { return !!p.prev && p.all.some(function (r) { return r.w != null && r.w !== 0; }); }
  function drawn(p) { return p.town.length + p.out.length; }
  function bestOf(rs) { return rs.reduce(function (b, r) { return !b || r.c > b.c || (r.c === b.c && (r.mi || 0) < (b.mi || 0)) ? r : b; }, null); }
  function lowOf(rs) { return rs.reduce(function (b, r) { return !b || r.c < b.c ? r : b; }, null); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function list(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }

  /* how the bids in town moved in a week, from the matched week-ago bids only; '' with none */
  function week(rs) {
    var ws = rs.filter(function (r) { return r.w != null; }).map(function (r) { return r.w; });
    if (!ws.length) return '';
    var lo = Math.min.apply(null, ws), hi = Math.max.apply(null, ws), one = rs.length === 1, who = one ? 'The bid in town' : 'Bids in town';
    var tail = ws.length < rs.length ? ' (' + ws.length + ' of ' + rs.length + ' posted both weeks).' : '.';
    var span = function (a, b) { return a === b ? num(a) + (Math.abs(a) === 1 ? ' cent' : ' cents') : num(a) + ' to ' + num(b) + ' cents'; };
    if (hi === 0 && lo === 0) return who + ' held where ' + (one ? 'it was' : 'they were') + ' a week before' + tail;
    if (lo >= 0) return who + ' rose ' + span(lo, hi) + ' in a week' + tail;
    if (hi <= 0) return who + ' fell ' + span(-hi, -lo) + ' in a week' + tail;
    return who + ' moved from ' + num(-lo) + ' down to ' + num(hi) + ' up in a week' + tail;
  }

  /* The headline is the finding, from the data shown; the take says what is plotted. */
  function story(p, cfg) {
    var C = p.Crop, place = cfg.town, T = p.town, O = p.out, bt = bestOf(T), bo = bestOf(O), yr = String(cfg.date || '').slice(0, 4);
    var head;
    if (!bt && !bo) return { head: 'No ' + p.adj + ' bids in or near ' + place + ' to compare today', take: '' };
    var oc = cashLead(p), tc = oc && bt ? townCash(p) : null;
    if (oc && bt) {
      head = C + ' ' + (p.verb === 'are' ? 'pay' : 'pays') + ' up to ' + cash(tc.cash) + ' cash in ' + place + '. The best cash bid outside town is ' + cash(oc.cash) + ' at ' + oc.town + ', ' + mi(oc.mi) + ' out.';
    } else if (bt && !O.length && p.alt.length) {
      var ba = bestOf(p.alt);
      head = C + ' ' + p.verb + ' ' + word(bt.c) + ' in ' + place + ' for ' + dmFull(p.ref.dm, yr) + ' delivery. Nearby elevators bid for ' + dmFull(p.altDm, yr) + ': the best is ' + word(ba.c) + ', ' + mi(ba.mi) + ' out.';
    } else if (bt && bo) {
      head = C + ' ' + p.verb + ' ' + word(bt.c) + ' in ' + place + '. ';
      var dc = Math.round((bo.c - bt.c) * 10) / 10;
      if (dc < 0) head += 'The best bid outside town is ' + word(bo.c) + ', ' + mi(bo.mi) + ' out.';
      else if (dc === 0) head += 'The best bid outside town is the same, ' + word(bo.c) + ', ' + mi(bo.mi) + ' out.';
      else head += 'The best bid within ' + NEAR_MI + ' miles is ' + word(bo.c) + ', ' + mi(bo.mi) + ' away, ' + num(dc) + (dc === 1 ? ' cent' : ' cents') + ' over the bid in town.';
    } else if (bt) {
      var elsewhere = p.other.some(function (r) { return !r.inTown; });
      head = C + ' ' + p.verb + ' ' + word(bt.c) + ' in ' + place + '. No other elevator within ' + NEAR_MI + ' miles posted a ' + p.adj + ' bid' +
        (elsewhere ? ' for ' + dmFull(p.ref.dm, yr) + ' delivery against ' + conMon(p.ref.vs) + ' futures.' : '.');
    } else {
      var here = p.other.some(function (r) { return r.inTown; }) || p.leftIn;
      head = 'No ' + (here ? 'comparable ' : '') + p.adj + ' bid in ' + place + ' today. The best within ' + NEAR_MI + ' miles is ' + word(bo.c) + ', ' + mi(bo.mi) + ' out.';
    }
    var n = drawn(p), terms = (p.ref ? dmFull(p.ref.dm, yr) + ' delivery' : '') + (conFull(p.ref && p.ref.vs) ? ', against ' + conFull(p.ref.vs) + ' ' + p.adj + ' futures' : '');
    var take = (n === 1 ? 'One ' + p.adj + ' bid' : n + ' ' + p.adj + ' bids') + ' within ' + NEAR_MI + ' miles, as of ' + day(cfg.date) + (terms ? ', ' + (n === 1 ? '' : 'all ') + 'for ' + terms : '') + '.';
    if (p.alt.length) take += ' Open dots: ' + plural(p.alt.length, 'bid') + ' for ' + dmFull(p.altDm, yr) + ' delivery on the same futures.';
    if (oc && bt) take += ' Cash on any futures month: ' + cash(tc.cash) + ' in town (' + conMon(tc.vs) + ' futures), ' + cash(oc.cash) + ' at ' + oc.town + ' (' + conMon(oc.vs) + ').' + (bo ? ' On ' + conMon(p.ref.vs) + ' futures the best outside town is ' + word(bo.c) + ' at ' + bo.town + ', ' + mi(bo.mi) + ' out.' : '');
    var wk = week(T); if (wk) take += ' ' + wk;
    return { head: head, take: take };
  }

  /* the readout line for one dot -> [bold, rest] */
  function readout(p, r) {
    if (!r) return ['', ''];
    var where = r.inTown ? 'in town' : mi(r.mi), yr = String(r.priced || '').slice(0, 4);
    var rest = cash(r.cash) + ' cash, ' + word(r.c) + (conMon(r.vs) ? ' ' + conMon(r.vs) : '') + ', ' + where + (r.alt ? ', for ' + dmFull(r.dm, yr) + ' delivery' : '') + ', posted ' + day(r.priced) + '.';
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
    if (moved(p)) s.push('Its line runs from its basis on ' + day(p.prev) + '.');
    else if (p.prev && p.all.some(function (r) { return r.w != null; })) s.push('No bid here moved from where it was on ' + day(p.prev) + '.');
    if (p.out.length || p.alt.length) s.push('Miles are straight-line from ' + (cfg.from || 'the town') + ' to each elevator’s pin. Dots that would touch are moved apart by at most half a mile; where that is not enough they overlap, and the readout steps through each.');
    if (p.med) s.push(st + ' median: ' + word(cents(p.med.median)) + ', ' + plural(p.med.n, p.adj + ' bid') + ' against ' + conMon(p.ref.vs) + ' futures.' + (p.med.usda ? ' ' + p.med.usda : ''));
    if (p.other.length) {
      var nm = p.other.map(function (r) { return r.name; }), k = nm.length;
      s.push('Not on the chart, a different delivery month or futures: ' + (k > 4 ? nm.slice(0, 4).join('; ') + ' and ' + (k - 4) + ' more' : nm.join('; ')) + '.');
    }
    if (p.away.length) { var aw = p.away.map(function (r) { return r.elevator + ' for delivery at ' + r.at; }); s.push('Left off, a price paid at another town’s plant: ' + aw.join('; ') + '.'); }
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
    var fx = opt.int ? function (v) { return String(Math.round(v)); } : f1;   // the printed pictures: whole pixels, fewer bytes on 1,400 pages
    var phone = W < 640, card = !!opt.card, fs = opt.fs || (phone ? 12 : 13), fb = fs + 1, H = opt.h || (phone ? 400 : 460);
    var T = p.town, O = p.out, A = p.alt || [], st = cfg.stName || cfg.st, o = [], obst = [], labs = [], gut = [], medDrawn = !phone;
    var minWk = phone && !card ? 10 : 0.05;   // a phone draws the week's line only for a move of 10 cents or more (the key says so)
    var vals = [];
    p.all.forEach(function (r) { vals.push(r.c); if (r.w != null && Math.abs(r.w) >= minWk) vals.push(Math.round((r.c - r.w) * 10) / 10); });
    if (p.med) vals.push(cents(p.med.median));
    if (!vals.length) vals = [0];
    var top = Math.ceil((Math.max.apply(null, vals) + 3) / 10) * 10, bot = Math.floor((Math.min.apply(null, vals) - 3) / 10) * 10;
    if (top - bot < 30) bot = top - 30;
    var stepT = (top - bot) / 10 > (phone || H < 300 ? 6 : 9) ? 20 : 10;
    if (stepT === 20) { top = Math.ceil(top / 20) * 20; bot = Math.floor(bot / 20) * 20; }
    var ticks = []; for (var v = top; v >= bot; v -= stepT) ticks.push(v);
    var L = Math.ceil(Math.max.apply(null, ticks.map(function (t) { return widthOf(word(t), fs, t === 0); }))) + 10;
    var R = phone ? 6 : Math.round(fs * 13.5), TOP = Math.round(fb * 2), BOT = Math.round(fs * 3.4);
    var y0 = TOP, y1 = H - BOT, Y = function (c) { return y0 + (top - c) / (top - bot) * (y1 - y0); };
    // room over the best dots for their words: one more step on top when they sit too near it
    var vmax = Math.max.apply(null, vals);
    // one band of headroom when the best dots sit under the top; more only when a label that must be drawn found no free place
    for (var bump = 0; bump < 1 + (opt.bump || 0) && (bump >= 1 || Y(vmax) - y0 < fb + 14); bump++) { top += stepT; ticks.unshift(top); L = Math.ceil(Math.max.apply(null, ticks.map(function (t) { return widthOf(word(t), fs, t === 0); }))) + 10; }
    var r0 = card ? 5.5 : phone ? 3.2 : 5.2, gap = phone ? 1.6 : 3, step = 2 * r0 + gap;   // a ring of the ground colour round each, so dots that overlap still read as two
    var pad = phone ? 8 : 16;
    var ZA = T.length ? Math.max(phone ? 92 : 150, Math.min(phone ? 132 : 260, T.length * step + 2 * pad + (phone ? 0 : 40))) : 0;
    var GX = T.length ? (phone ? 12 : 28) : 0;
    var x0 = L + ZA + GX, x1 = W - R - (phone ? 10 : 14), Xm = function (m) { return x0 + Math.max(0, Math.min(NEAR_MI, m)) / NEAR_MI * (x1 - x0); };
    var add = function (b) { obst.push(b); };
    var t = function (x, y, s, cls, anchor) {
      var c = [/gold/.test(cls) ? 'g' : /mid/.test(cls) ? 'm' : '', /(^| )b( |$)/.test(cls) ? 'b' : '', /big/.test(cls) ? 'B' : '', /(^| )h( |$)/.test(cls) ? 'h' : '', anchor === 'end' ? 'e' : anchor === 'middle' ? 'c' : ''].filter(Boolean).join(' ');
      return '<text x="' + fx(x) + '" y="' + fx(y) + '"' + (c ? ' class="' + c + '"' : '') + '>' + esc(hy(s)) + '</text>';
    };
    var P = { gr: [], ev: [], ax: [], md: [], wk: [], ld: [] }, H0 = function (y, a, b) { return 'M' + fx(a) + ' ' + fx(y) + 'H' + fx(b); }, V0 = function (x, a, b) { return 'M' + fx(x) + ' ' + fx(a) + 'V' + fx(b); };
    // the in-town zone, the grid, the axis words
    var zone = T.length ? '<rect class="z" x="' + L + '" y="' + y0 + '" width="' + fx(ZA) + '" height="' + fx(y1 - y0) + '"/>' : '';
    ticks.forEach(function (c) {
      var y = Y(c), ev = c === 0;
      P[ev ? 'ev' : 'gr'].push(H0(y, L, phone ? x1 : W - R));
      if (ev) add({ x0: L, x1: phone ? x1 : W - R, y0: y - 3, y1: y + 3, rule: 'ev' });   // no words on the even rule (3 px clear)
      o.push(t(L - 8, y + fs * 0.36, word(c), ev ? 'b' : 'mid', 'end'));
    });
    var head = function (cands, cx, lo, hi) {   // the first wording that fits between lo and hi, centred on cx where it can be
      for (var i = 0; i < cands.length; i++) {
        var w = widthOf(cands[i], fb, true), x = Math.max(lo + w / 2 + 3, Math.min(hi - w / 2 - 3, cx));
        if (w + 6 <= hi - lo || i === cands.length - 1) { o.push(t(x, y0 - fb * 0.7, cands[i], 'b big', 'middle')); labs.push({ x0: x - w / 2 - 2, x1: x + w / 2 + 2, y0: y0 - fb * 1.7, y1: y0 - 2, head: 1 }); return; }
      }
    };
    if (T.length) head(['In ' + cfg.town, 'In town'], L + ZA / 2, L, L + ZA + GX / 2);
    var OA = O.length ? O : A;
    if (OA.length) {
      var m0 = Math.round(OA[0].mi), m1 = Math.round(OA[OA.length - 1].mi), span = m0 === m1 ? mi(OA[0].mi) : m0 + ' to ' + m1 + ' miles', mon = dmFull(p.altDm, String(cfg.date).slice(0, 4));
      var smi = m0 === m1 ? m0 + ' mi' : m0 + ' to ' + m1 + ' mi';
      head(O.length ? [(O.length === 1 ? 'One elevator ' : 'Elevators ') + span + ' out', span + ' out', span, smi] : [mon + ' delivery, ' + span + ' out', mon + ', ' + span, mon.slice(0, 3) + ', ' + smi, smi],
        (x0 + x1) / 2, L + ZA + GX / 2, W - 2);
    } else {
      var nt = phone ? ['No other bid within', NEAR_MI + ' miles to compare'] : ['No other elevator within ' + NEAR_MI + ' miles', 'posted a bid to compare'];
      nt.forEach(function (s, i) { o.push(t((x0 + x1) / 2, (y0 + y1) / 2 + (i - 0.5) * fs * 1.4, s, 'mid', 'middle')); });
    }
    // the state's middle bid on the same futures month: one dashed rule
    var ym = p.med ? Y(cents(p.med.median)) : null;
    if (p.med) { P.md.push(H0(ym, L, phone ? x1 : W - R)); add({ x0: L, x1: phone ? x1 : W - R, y0: ym - 3, y1: ym + 3, rule: 'md' }); }   // nor on the median's dashes, but its own name
    // the dots: in town side by side, best first; outside at their miles
    var dots = [], best = bestOf(T.concat(O)), bestC = best ? best.c : null;
    var stT = T.length > 1 ? Math.min(step, (ZA - 2 * pad - 2 * r0) / (T.length - 1)) : step, rT = Math.min(r0, Math.max(1.6, (stT - 0.8) / 2));
    T.forEach(function (r) { dots.push({ x: L + pad + rT, y: Y(r.c), r: rT, d: r }); });
    T.forEach(function (r, i) { dots[i].x = L + pad + rT + i * stT; });
    // outside town: at its miles, or moved sideways by at most half a mile where it would touch another; where that is
    // not enough it overlaps (round 1: dots were pushed miles off and past the 40 tick)
    var cap = 0.5 / NEAR_MI * (x1 - x0), placed = [], over = 0;
    O.concat(A).forEach(function (r) {
      var base = Xm(r.mi), y = Y(r.c), q = { x: base, y: y, r: r0, d: r }, ok = false;
      var clash = function (x) { return placed.some(function (z) { return Math.hypot(z.x - x, z.y - y) < 2 * r0 + 1; }); };
      for (var k = 0; k <= 2 * Math.floor(cap / 0.5); k++) {
        var x = base + (k % 2 ? (k + 1) / 2 : -k / 2) * 0.5;
        if (x < x0 || x > x1) continue;
        if (!clash(x)) { q.x = x; ok = true; break; }
      }
      if (!ok) { q.x = Math.max(x0, Math.min(x1, base)); q.over = true; over++; }
      placed.push(q); dots.push(q);
    });
    dots.forEach(function (q) {
      var prev = q.d.w == null ? null : Math.round((q.d.c - q.d.w) * 10) / 10;
      if (prev != null && Math.abs(q.d.w) >= minWk) { P.wk.push(V0(q.x, Y(prev), q.y)); add({ x0: q.x - 1.5, x1: q.x + 1.5, y0: Math.min(Y(prev), q.y), y1: Math.max(Y(prev), q.y) }); }
    });
    dots.forEach(function (q, i) {
      q.i = i; q.gold = !q.d.alt && q.d.c === bestC;
      add({ x0: q.x - q.r - 1, x1: q.x + q.r + 1, y0: q.y - q.r - 1, y1: q.y + q.r + 1, dot: 1, q: q });
    });
    // the words on the data: each tries its places in order; the best bid's words are placed first and never left off
    var PR = phone ? W - 2 : W - R + 4;   // the words on the data stay left of the margin column, which has its own
    var inPlot = function (b) { return b.x0 >= L - 2 && b.x1 <= PR && b.y0 >= y0 - 2 && b.y1 <= y1 + 2; };
    /* words set away from their dot get a leader: a thin dotted slant from the dot to the label's nearest corner (never
       straight up over the dot, where a line means where the bid was a week before). null: no leader needed;
       false: the leader would cross a label or a dot, so the place is refused */
    var leaderOf = function (q, b) {
      if (!q) return null;
      var cx = Math.max(b.x0, Math.min(b.x1, q.x)), cy = q.y < b.y0 ? b.y0 : q.y > b.y1 ? b.y1 : q.y;
      if (Math.hypot(cx - q.x, cy - q.y) < q.r + fs) return null;
      if (cx === q.x && Math.abs(cy - q.y) < q.r + fs * 2.4) return null;   // a label right over (or under) its dot, within a line: no leader
      if (cy !== q.y && Math.abs(cx - q.x) < 10) cx = Math.abs(b.x0 - q.x) > Math.abs(b.x1 - q.x) ? b.x0 + 2 : b.x1 - 2;   // a slant, to a corner
      var d = Math.hypot(cx - q.x, cy - q.y), ux = (cx - q.x) / d, uy = (cy - q.y) / d;
      var a = [q.x + ux * (q.r + 2), q.y + uy * (q.r + 2)], e = [cx - ux * 4, cy - uy * 4], pts = [];
      for (var f = 0; f <= 1 - 2 / Math.max(4, d); f += 3 / Math.max(3, d)) pts.push({ x0: a[0] + (e[0] - a[0]) * f - 1, x1: a[0] + (e[0] - a[0]) * f + 1, y0: a[1] + (e[1] - a[1]) * f - 1, y1: a[1] + (e[1] - a[1]) * f + 1 });
      if (pts.some(function (z) { return labs.some(function (l) { return hit(l, z); }) || obst.some(function (o) { return ((o.dot && o.q !== q) || o.rule) && hit(o, z); }); })) return false;   // nor across the median or the even rule
      return { d: 'M' + fx(a[0]) + ' ' + fx(a[1]) + 'L' + fx(e[0]) + ' ' + fx(e[1]), pts: pts };
    };
    var place = function (lines, cands, cls, minX, must, q, own) {
      var clear = function (z) { return !(own && z.rule === own); }, lh = fs * 1.3;
      var w = Math.max.apply(null, lines.map(function (s, k) { var cl = cls[k] || ''; return widthOf(s, /big/.test(cl) ? fb : fs, /(^| )b( |$)/.test(cl)); }));
      var box = function (c) { var x = c.anchor === 'end' ? c.x - w : c.anchor === 'middle' ? c.x - w / 2 : c.anchor === 'clamp' ? Math.min(Math.max(c.x - w / 2, minX == null ? L + 2 : minX + 2), PR - 2 - w) : c.x; return { x: x, b: { x0: x - 2, x1: x + w + 2, y0: c.y - fs - 1, y1: c.y + (lines.length - 1) * lh + 4 } }; };
      for (var k = 0; k < cands.length; k++) {
        var bb = box(cands[k]);
        if (minX != null && bb.b.x0 < minX) continue;
        if (inPlot(bb.b) && !obst.concat(labs).some(function (z) { return clear(z) && hit(z, bb.b); })) {
          var ld = leaderOf(q, bb.b);
          if (ld === false) continue;
          lines.forEach(function (s, j) { o.push(t(bb.x, cands[k].y + j * lh, s, cls[j] || '', '')); });
          if (own) bb.b.own = own;
          labs.push(bb.b); if (ld) { P.ld.push(ld.d); ld.pts.forEach(function (z) { z.leader = 1; z.of = bb.b; obst.push(z); }); }
          return true;
        }
      }
      if (must && lines.length > 1 && place(lines.slice(-1), cands, cls.slice(-1), minX, false, q, own)) return true;
      if (must && q && !cands.grid) {   // anywhere free in the plot, joined to its dot by a leader
        var grid = [], gx0 = minX == null ? L + 2 : minX + 2;
        for (var gy = y0 + fs + 4; gy < y1 - 4; gy += lh) for (var gx = gx0; gx < PR - 20; gx += 16) grid.push({ x: gx, y: gy });
        grid.sort(function (a, c) { return Math.hypot(a.x - q.x, a.y - q.y) - Math.hypot(c.x - q.x, c.y - q.y); }); grid.grid = 1;
        if (place(lines.slice(-1), grid, cls.slice(-1), minX, false, q, own)) return true;
      }   // its last line alone, where both do not fit
      if (must) {   // no free place: the first one that stays in the picture, on a halo
        for (k = 0; k < cands.length; k++) {
          bb = box(cands[k]);
          if (inPlot(bb.b) && (minX == null || bb.b.x0 >= minX) && !labs.some(function (z) { return hit(z, bb.b); })) {
            lines.forEach(function (s, j) { o.push(t(bb.x, cands[k].y + j * lh, s, (cls[j] || '') + ' h', '')); });
            bb.b.forced = 1; labs.push(bb.b); return true;
          }
        }
        for (k = 0; k < cands.length; k++) {   // the last resort: the first place inside the picture, whatever it covers
          bb = box(cands[k]);
          if (inPlot(bb.b)) { lines.forEach(function (s, j) { o.push(t(bb.x, cands[k].y + j * lh, s, (cls[j] || '') + ' h', '')); }); bb.b.forced = 2; labs.push(bb.b); return true; }
        }
      }
      return false;
    };
    var near = function (q, lines) {   // around a dot: above right, above left, right, below right, below left, left, then further out
      var lh = fs * 1.3, hgt = lines * lh, g = q.r + 6, up = q.y - g - hgt + lh * 0.8, dn = q.y + g + fs;
      return [{ x: q.x - q.r, y: up }, { x: q.x + q.r, y: up, anchor: 'end' }, { x: q.x + g, y: q.y + fs * 0.35 - (lines - 1) * lh / 2 },
              { x: q.x - q.r, y: dn }, { x: q.x + q.r, y: dn, anchor: 'end' }, { x: q.x - g, y: q.y + fs * 0.35, anchor: 'end' },
              { x: q.x - q.r, y: up - lh }, { x: q.x + q.r, y: up - lh, anchor: 'end' }, { x: q.x - q.r, y: up - 2 * lh }, { x: q.x + g, y: up }, { x: q.x - g, y: up, anchor: 'end' },
              { x: q.x - q.r, y: dn + lh }, { x: q.x + q.r, y: dn + lh, anchor: 'end' },
              { x: q.x, y: up, anchor: 'clamp' }, { x: q.x, y: dn, anchor: 'clamp' }, { x: q.x, y: up - lh, anchor: 'clamp' }, { x: q.x, y: dn + lh, anchor: 'clamp' }, { x: q.x, y: up - 2 * lh, anchor: 'clamp' }, { x: q.x + g, y: q.y - lh * (lines + 0.2) }, { x: q.x + g, y: q.y - lh * (lines + 1.2) }, { x: q.x - g, y: q.y - lh * (lines + 0.2), anchor: 'end' },
              { x: q.x, y: up - 3 * lh, anchor: 'clamp' }, { x: q.x, y: up - 4 * lh, anchor: 'clamp' }, { x: q.x, y: dn + 2 * lh, anchor: 'clamp' },
              { x: PR - 2, y: up, anchor: 'end' }, { x: PR - 2, y: up - lh, anchor: 'end' }, { x: PR - 2, y: up - 2 * lh, anchor: 'end' }, { x: PR - 2, y: dn, anchor: 'end' }];
    };
    var golds = dots.filter(function (q) { return q.gold; });
    var tq = dots.filter(function (q) { return q.d.inTown; }), oq = dots.filter(function (q) { return !q.d.inTown && !q.d.alt; }), aq = dots.filter(function (q) { return q.d.alt; });
    var outX = T.length ? L + ZA + 2 : null, cashLeadR = cashLead(p);   // a bid outside town is never named inside the town's band
    // 1. the best bid, in the accent: over the best dots in town, with their count
    if (golds.length && golds[0].d.inTown) {
      var gk = golds.filter(function (q) { return q.d.inTown; }).length, g0 = golds[0], gtxt = word(bestC) + (gk > 1 ? ': ' + gk + ' bids' : '');
      var gc = [{ x: g0.x - g0.r, y: g0.y - g0.r - 8 }, { x: g0.x - g0.r, y: g0.y - g0.r - 8 - fs }, { x: g0.x - g0.r, y: g0.y + g0.r + fb + 4 }, { x: g0.x - g0.r, y: g0.y - g0.r - 8 - 2 * fs }];
      if (!place([gtxt], gc, ['gold b big']) && gk > 1) place([word(bestC)], gc, ['gold b big'], null, true);
    }
    // 2. the best bid outside town (in the accent when it is the best within 40 miles)
    var bo = oq.filter(function (q) { return q.d === bestOf(O); })[0];
    if (bo) {
      var ow = bo.d.town, gcls = bo.gold ? 'gold b big' : 'b big';
      // a page with no free place leaves it to the headline and the readout, which opens on it; the card always names it
      if (phone) place([ow + ', ' + word(bo.d.c)], near(bo, 1), [gcls], outX, card, bo);
      else if (!place([bo.gold ? 'Best bid within ' + NEAR_MI + ' miles' : cashLeadR ? 'Best on ' + conMon(p.ref.vs) + ' futures' : 'Best bid outside town', ow + ', ' + mi(bo.d.mi) + ': ' + word(bo.d.c)], near(bo, 2), ['', gcls], outX, false, bo))
        place([ow + ', ' + word(bo.d.c)], near(bo, 1), [gcls], outX, card, bo);
    }
    var ba = aq.filter(function (q) { return q.d === bestOf(A); })[0];
    if (ba) place([ba.d.town + ', ' + word(ba.d.c)], near(ba, 1), ['b big'], outX, !phone || card, ba);
    // 3. the state median: in the right margin from 640 px (with the lowest outside town), on one line above its rule on a phone
    var lo = oq.length > 1 ? oq.filter(function (q) { return q.d.c === lowOf(O).c; }) : [];
    if (lo.length && lo[0].d.c === bestC) lo = [];
    var loTowns = lo.map(function (q) { return q.d.town; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var loWho = loTowns.length > 2 ? plural(lo.length, 'elevator') : list(loTowns);
    if (!phone) {
      var gx = W - R + 12, items = [], lh = fs * 1.3, room = R - 16;
      if (p.med) items.push({ y: ym, lines: [st + ' median', word(cents(p.med.median))].concat(card ? [] : [plural(p.med.n, 'bid') + ', ' + day(cfg.date)].concat(p.med.usdaShort ? [p.med.usdaShort] : [])), cls: ['b big', 'b big', 'mid', 'mid'] });
      if (lo.length) items.push({ y: lo[0].y, lines: ['Lowest: ' + word(lo[0].d.c)].concat(loWho ? [loWho] : []), cls: ['b big', 'mid'] });
      items.forEach(function (it) {
        var ls = [], cs = [];
        it.lines.forEach(function (s, j) {
          var cl = it.cls[j] || '', cur = '';
          s.split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (cur && widthOf(x, /big/.test(cl) ? fb : fs, /(^| )b( |$)/.test(cl)) > room) { ls.push(cur); cs.push(cl); cur = w; } else cur = x; });
          if (cur) { ls.push(cur); cs.push(cl); }
        });
        it.lines = ls; it.cls = cs; it.h = ls.length * lh; it.top = it.y - it.h / 2;
      });
      // stacked top down clear of each other, then, if the last runs past the plot, pushed back up as a block, never into each other
      items.sort(function (a, b) { return a.top - b.top; });
      var sp = fs * 1.2;
      items.forEach(function (it, i) { it.top = Math.max(it.top, y0, i ? items[i - 1].top + items[i - 1].h + sp : -1e9); });
      for (var i = items.length - 1; i >= 0; i--) { var lim = i === items.length - 1 ? y1 - items[i].h : items[i + 1].top - sp - items[i].h; if (items[i].top > lim) items[i].top = lim; }
      items.forEach(function (it) { gut.push({ y0: it.top, y1: it.top + it.h }); it.lines.forEach(function (s, j) { o.push(t(gx, it.top + fs + j * lh, s, it.cls[j], '')); }); });
    } else if (p.med) {
      var mt = st + ' median: ' + word(cents(p.med.median)), mw = widthOf(mt, fs, true), mc = [];
      for (var mx = L + 6; mx <= x1 - mw; mx += 12) mc.push({ x: mx, y: ym - 6 });
      for (mx = L + 6; mx <= x1 - mw; mx += 12) mc.push({ x: mx, y: ym + fs + 4 });
      medDrawn = place([mt], mc, ['b'], null, card, null, 'md');   // no free place on a phone: the key above the picture names the dashed line
    }
    // 4. the biggest move in a week outside town, 10 cents or more
    var mv = oq.filter(function (q) { return q.d.w != null && Math.abs(q.d.w) >= 10 && q !== bo && lo.indexOf(q) < 0; }).sort(function (a, b) { return Math.abs(b.d.w) - Math.abs(a.d.w) || a.d.mi - b.d.mi; })[0];
    if (mv && !phone) place([mv.d.town + ': ' + word(mv.d.c) + ',', (mv.d.w > 0 ? 'up ' : 'down ') + num(Math.abs(mv.d.w)) + ' in a week'], near(mv, 2), ['', ''], outX, false, mv);   // wide only: a phone's corner is too tight
    // 5. the lowest in town, beside its dot
    if (tq.length > 1) {
      var lt = tq[tq.length - 1];
      if (lt.d.c !== bestC) {
        var ltx = phone ? ['Lowest in town: ' + word(lt.d.c)] : ['Lowest in town:', word(lt.d.c)];
        place(ltx, [{ x: lt.x + lt.r + 8, y: lt.y + fs * 0.35 - (ltx.length - 1) * fs * 0.65 }, { x: lt.x + lt.r + 8, y: lt.y + fs * 1.5 }, { x: lt.x - lt.r, y: lt.y + lt.r + fs + 6 }], ['', '']);   // beside its dots or not at all
      }
    }
    // 6. on a phone, the lowest outside town beside its dot, or left to the readout
    if (phone && lo.length) place(['Lowest: ' + word(lo[0].d.c)], near(lo[0], 1), [''], outX);
    // the miles axis, and the count under the town zone
    P.ax.push(H0(y1, x0, x1));
    [0, 10, 20, 30, 40].forEach(function (m) { var x = Xm(m); P.ax.push(V0(x, y1, y1 + 5)); o.push(t(x, y1 + fs + 6, String(m), 'mid', 'middle')); });
    var axt = 'Miles from ' + cfg.town + ', straight line';
    if (widthOf(axt, fs) > x1 - x0 + GX + ZA) axt = 'Miles, straight line';
    o.push(t(x1 + (phone ? 4 : 6), y1 + fs * 2.6 + 4, axt, 'mid', 'end'));
    if (T.length) o.push(t(L + ZA / 2, y1 + fs + 6, T.length === 1 ? '1 bid' : T.length + ' bids', 'mid', 'middle'));
    var aria = p.Crop + ' basis by distance from ' + cfg.town + ': ' + drawn(p) + ' bids within ' + NEAR_MI + ' miles' + (p.med ? ', with the ' + st + ' median' : '') + '.';
    // the lines first, then the dots (a ring of the page colour round each; an open dot is a ring of ink), then the words
    var rIn = dots.filter(function (q) { return q.d.inTown; }), ro = rIn.length ? rIn[0].r : r0, wd = function (r) { return fx(2 * r); };
    var dp = function (cls, pts) { return pts.length ? '<path class="' + cls + '" d="' + pts.join('') + '"/>' : ''; };
    var lines = ['gr', 'ev', 'ax', 'md', 'wk', 'ld'].map(function (k) { return dp(k, P[k]); }).join('');
    var uid = 'bd' + (opt.id || 'p'), defs = [], dd = '', sets = [[tq, ro], [oq, r0], [aq, r0]];
    sets.forEach(function (sx, a) {
      var r = sx[1];
      [['di', function (q) { return !q.gold; }], ['dg', function (q) { return q.gold; }]].forEach(function (k, b) {
        var pts = sx[0].filter(k[1]).map(function (q) { return 'M' + fx(q.x) + ' ' + fx(q.y) + 'h0'; }); if (!pts.length) return;
        var id = uid + a + b; defs.push('<path id="' + id + '" d="' + pts.join('') + '"/>');
        dd += '<use href="#' + id + '" class="dr" style="stroke-width:' + fx(2 * r + 3) + '"/><use href="#' + id + '" class="' + k[0] + '" style="stroke-width:' + wd(r) + '"/>' +
          (a === 2 ? '<use href="#' + id + '" class="dr" style="stroke-width:' + fx(2 * r - 3) + '"/>' : '');
      });
    });
    dd = (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') + dd;
    if (labs.some(function (b) { return b.forced; }) && (opt.bump || 0) < 2) { var o2 = {}, kk; for (kk in opt) o2[kk] = opt[kk]; o2.bump = (opt.bump || 0) + 1; return svg(p, cfg, W, o2); }
    var s = '<svg class="bd-svg' + (opt.cls ? ' ' + opt.cls : '') + '"' + (card ? ' xmlns="http://www.w3.org/2000/svg"' : '') + ' viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(aria) + '" style="font-size:' + fs + 'px' + (card ? ';font-family:' + FONT : '') + '">' +
      (card ? cardStyle(CARD) : '') + zone + lines + dd + o.join('') + '</svg>';
    return { svg: s, dots: dots.map(function (q) { return { x: q.x, y: q.y, r: q.r, i: q.i, base: q.d.inTown ? null : Xm(q.d.mi), over: !!q.over }; }), H: H, W: W, gut: gut, labs: labs, obst: obst, medDrawn: medDrawn, plotBox: { x0: L - 2, x1: PR, y0: y0 - 2, y1: y1 + 2 }, order: dots.map(function (q) { return q.d; }), over: over, minWk: minWk, cap: cap, x0: x0, x1: x1 };
  }

  /* the default dot the readout opens on: the best bid outside town, else the best in town */
  function firstDot(p) { var b = bestOf(p.out) || bestOf(p.town); return b ? p.all.indexOf(b) : -1; }
  function axisText(p) { return p.adj.charAt(0).toUpperCase() + p.adj.slice(1) + ' basis, cents a bushel over or under ' + (conMon(p.ref && p.ref.vs) || 'the') + ' futures'; }
  /* the key above the picture: what a dot, the gold, an open dot and a line mean, only what this view draws. The words
     in .bd-kph show only where the phone rule (a line for a move of 10 cents or more) applies. -> HTML */
  function keyHtml(p, cfg) {
    var yr = String(p.prev || '').slice(0, 4), parts = ['dot: today&rsquo;s bid', '<span class="bd-kg">gold</span>: ' + (p.alt && p.alt.length ? 'the best on the town&rsquo;s terms' : 'the best within ' + NEAR_MI + ' miles')];
    if (p.alt && p.alt.length) parts.push('open dot: ' + esc(dmFull(p.altDm, yr)) + ' delivery');
    if (p.med) parts.push('dashes: the ' + esc((cfg && (cfg.stName || cfg.st)) || 'state') + ' median, ' + esc(word(cents(p.med.median))));
    if (moved(p)) parts.push('line: its move since ' + esc(day(p.prev)) + '<span class="bd-kph">, when 10 cents or more</span>');
    return parts.join('; ');
  }
  function cardText(p, cfg) {
    var st = story(p, cfg);
    return { head: st.head, take: st.take, kicker: cfg.town + ', ' + (cfg.st || '') + ' · ' + p.adj + ' basis by distance', source: (moved(p) ? 'Each line runs from where that bid was on ' + day(p.prev) + '. ' : '') + 'Posted elevator bids, read by AGSIST' + (readDays(p) ? ' ' + readDays(p) : '') + (p.med && p.med.usdaShort ? '. ' + p.med.usdaShort : '') + '. No freight cost taken off.' };
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
    /* the page without script prints the phone's picture (a desktop reader without script gets it centred in a narrow
       column, basis_drive.CSS_LINK's noscript style); the script draws at the box's own width as soon as it loads */
    var cfg = prep(cfg0, docs, bs), p = pick(docs, cfg, crop), st = story(p, cfg), short = !p.out.length && !p.alt.length;
    var pw = svg(p, cfg, W || 358, { id: 'p', h: short ? 240 : 400, int: true });
    var k = firstDot(p), rd = readout(p, p.all[k]);
    return { crop: crop, n: drawn(p), inTown: p.town.length, out: p.out.length, alt: p.alt.length, short: short, head: st.head, take: st.take, axis: axisText(p),
             prev: moved(p) ? day(p.prev) : '', key: keyHtml(p, cfg), svg: pw.svg, read: rd, note: note(p, cfg), first: k };
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
  function card(p, cfg, done) { frame(cardText(p, cfg), cfg, function (w, h) { return svg(p, cfg, w, { card: true, fs: 16, h: h }).svg; }, done); }
  /* the 1200 x 630 picture: the kit card's frame, the headline and take, a picture drawn by draw(width, height), the source */
  function frame(ct2, cfg, draw, done) {
    var D = root.document, W = 1200, H = 630, c = D.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); if (!x || !root.Image) { done(null); return; }
    var meas = function (wt) { return function (s, size) { x.font = wt + ' ' + size + 'px ' + FONT; return x.measureText(s).width; }; };
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
    var ph = Math.max(220, Math.round(H - y - 70)), pic = { svg: draw(W - 48, ph) };
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
    var plot = q('.bd-plot'), read = q('.bd-read'), head = q('.bd-h'), take = q('.bd-take'), axis = q('.bd-axis'), noteEl = q('.bd-note'), keyT = q('.bd-kt');
    var urlC = ''; try { urlC = new URLSearchParams(root.location.search).get('crop') || ''; } catch (e) {}
    if (!cfg.url) { var cn = root.document.querySelector('link[rel="canonical"]'); cfg.url = cn ? cn.href : String(root.location.href).split(/[?#]/)[0]; }
    var docs = null, cur = cfg.crops && cfg.crops.indexOf(urlC) >= 0 ? urlC : (cfg.crops || ['corn'])[0], p = null, pic = null, sel = -1, lastW = 0;
    var say = function (k) {
      var rd = readout(p, p.all[k]);
      read.innerHTML = rd[0] ? '<b>' + esc(hy(rd[0])) + '</b> ' + esc(hy(rd[1])) + ' <span class="bd-hint bd-ht">Tap a dot to read an elevator.</span><span class="bd-hint bd-hc">Click a dot or use the arrow keys.</span>' : '';
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
      box.classList.toggle('bd-narrow', W < 640); plot.classList.toggle('bd-short', !p.out.length && !p.alt.length);
      var st = story(p, cfg);
      head.textContent = hy(st.head); take.textContent = hy(st.take); axis.textContent = axisText(p); noteEl.textContent = hy(note(p, cfg));
      if (keyT) keyT.innerHTML = keyHtml(p, cfg);
      pic = svg(p, cfg, W, { h: plot.clientHeight || undefined });
      plot.innerHTML = pic.svg;
      // the readout holds the room of its longest line, so nothing under it moves when a dot is read
      read.style.minHeight = ''; var base = parseFloat(root.getComputedStyle(read).minHeight) || 0;
      var keep = sel >= 0 && p.all[sel] ? sel : firstDot(p), hmax = base; read.style.minHeight = '0';
      p.all.forEach(function (r, k) { say(k); hmax = Math.max(hmax, read.getBoundingClientRect().height); });
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
        sel = -1; draw(true); if (box.classList.contains('bd-on-hist')) month(); ga('basis_drive_crop');
        try { var u = new URL(root.location.href); if (cur === (cfg.crops || [])[0]) u.searchParams.delete('crop'); else u.searchParams.set('crop', cur); root.history.replaceState(null, '', u.toString()); } catch (e) {}
      });
      b.setAttribute('aria-pressed', String(b.getAttribute('data-crop') === cur));
    });
    var views = [].slice.call(box.querySelectorAll('.bd-view button')), hist = q('.bd-hist');
    views.forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-view'); views.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        box.classList.toggle('bd-on-hist', v === 'hist'); box.classList.toggle('bd-old', v === 'hist' && !MONTH_V2);
        if (hist) hist.hidden = v !== 'hist';
        if (v === 'hist' && MONTH_V2) month();
        else if (v === 'hist') { var dt = hist && hist.querySelector('details'); if (dt && !dt.open) dt.open = true; }   // the history box, as it has been
        else draw(true);   // back on the distance view: drawn again for the crop pressed now (a redraw is skipped while hidden)
        ga('basis_drive_view');
      });
    });
    /* the second view, the month in one band (components/basis-month.js, loaded the first time it is asked for) */
    var monthApi = null, monthLoading = null;
    var month = function () {
      if (!hist) return;
      // the last day of the month view is the town's bids this view draws, so the two views agree on it
      var today = function (crop, d) { var pp = pick(docs, cfg, crop); return todayOf(pp, d); };
      var go = function () { if (root.BasisMonth) { monthApi = monthApi || root.BasisMonth.mount(hist, { cfg: cfg, crop: cur, head: head, take: take, bs: bsDoc, today: today }); monthApi.crop(cur); } };
      if (root.BasisMonth) return go();
      if (!monthLoading) monthLoading = new Promise(function (ok) { var sc = root.document.createElement('script'); sc.src = '/components/basis-month.js?v=1'; sc.onload = ok; sc.onerror = ok; root.document.head.appendChild(sc); });
      monthLoading.then(go);
    };
    var tools = q('.bd-tools');
    if (tools) {
      var link = function () { var u = (cfg.url || String(root.location.href).split('#')[0].split('?')[0]) + (cur !== (cfg.crops || [])[0] ? '?crop=' + cur : '') + '#drive'; return u; };
      var flash = function (b, s) { var t0 = b.textContent; b.textContent = s; setTimeout(function () { b.textContent = t0; }, 1800); };
      var cp = tools.querySelector('.bd-copy'), sv = tools.querySelector('.bd-save');
      if (cp) cp.addEventListener('click', function () { var u = link(); try { root.navigator.clipboard.writeText(u).then(function () { flash(cp, 'Link copied'); }, function () { flash(cp, u); }); } catch (e) { flash(cp, u); } ga('basis_drive_link'); });
      if (sv) sv.addEventListener('click', function () {
        if (!p) return;
        if (box.classList.contains('bd-on-hist') && monthApi) { monthApi.save(link().replace(/#drive$/, '')); return; }
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
    load();   // at once: the printed picture is a stand-in, not the view (round 1: a desktop reader saw it until scrolling near)
  }
  function init() { [].slice.call(root.document.querySelectorAll('[data-drive]')).forEach(mount); }

  var api = { todayOf: todayOf, frame: frame, cardStyle: cardStyle, CARD: CARD, esc: esc, hy: hy, day: day, ct: ct, widthOf: widthOf, hit: hit, f1: f1, prep: prep, keyHtml: keyHtml, readDays: readDays, pick: pick, story: story, svg: svg, readout: readout, note: note, render: render, cardText: cardText, word: word, miles: miles, cents: cents, firstDot: firstDot, axisText: axisText, NEAR_MI: NEAR_MI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.BasisDrive = api;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
