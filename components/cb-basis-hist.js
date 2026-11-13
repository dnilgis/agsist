/* components/cb-basis-hist.js -- "Basis since Oct 12, 2026" on a cash-bids town page.
 *
 * The town page (scripts/build_cash_bid_pages.py history_box) carries only a
 * closed <details data-basis-hist="WI" data-boards='[[name,[cities]],...]'>.
 * Nothing of the history is in the page: the first time the box is opened this
 * fetches data/basis-sparklines/<ST>.json (scripts/build_basis_sparklines.py,
 * one file per state, real change points only) and draws, per elevator and
 * crop, the basis for the NEAREST delivery month on each date.
 *
 * WHAT IS DRAWN, AND WHAT IS NOT
 *   The log keeps a point only on a day a basis changed, per elevator, crop,
 *   contract and delivery month. A basis holds until its next change, so the
 *   line is a step, never a slope. On each date the delivery month shown is
 *   the nearest one not yet past; when that month or its futures contract
 *   changes, the step says so (a thin mark, and the table names both).
 *   Nothing is interpolated, averaged or carried past the last logged run.
 *   An elevator with no logged change shows a plain line saying so.
 *   The log's public record starts on its publicFrom day (2026-10-12), and
 *   the heading names that day with its year.
 *
 * Matching: the log writes "CDR FARMS, LLC" where the network writes "CDR
 * Farms LLC"; case, punctuation, "&"/"and" and trailing legal and co-op words
 * are dropped before comparing (the rule components/homepage-extras.js uses).
 * The town must still match.
 */
(function () {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MM = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var CODES = 'FGHJKMNQUVXZ';
  var CROPS = [['corn', 'Corn'], ['soybeans', 'Soybeans'], ['wheat', 'Wheat']];
  var TABLE_MAX = 10;
  var cache = {};
  var REF_YEAR = String(new Date().getFullYear());   /* set to the log's own year on render */

  /* One elevator across spellings: elevNames.facKey (components/elev-names.js, twin of
     scripts/elevator_names.fac_key that the town builder keys the box with). Older town pages do
     not load elev-names.js themselves, so it is fetched once here when missing. */
  var namesReady = null;
  function needNames() {
    if (names()) return Promise.resolve(names());
    if (!namesReady) namesReady = new Promise(function (ok) {
      var sc = document.createElement('script');
      sc.src = '/components/elev-names.js?v=3';
      sc.onload = function () { ok(window.elevNames || null); };
      sc.onerror = function () { ok(null); };
      document.head.appendChild(sc);
    });
    return namesReady;
  }
  function names() { return (typeof window !== 'undefined' && window.elevNames) || (typeof require === 'function' ? require('./elev-names.js') : null); }
  function normFac(s) { return names().facKey(s); }
  /* Twin of norm_town() in scripts/build_cash_bid_pages.py: "St. Ansgar" = "SAINT ANSGAR". */
  function normKey(s) {
    return String(s || '').toUpperCase().trim().replace(/^(STE?)\b\.?/, function (m, a) { return a === 'ST' ? 'SAINT' : 'SAINTE'; })
      .replace(/^FT\b\.?/, 'FORT').replace(/[^A-Z0-9]/g, '');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* The log's delivery-month field as each board wrote it -> 'YYYY-MM', or
     null when it names no month ("HARVEST 26", "IN STORE", "NEW CROP").
     "10/01/2026", "OCT 26", "Oct-26", "OCTOBER 2026", "Oct 01, 2026",
     "01 OCT 2026 TO 31 OCT 2026", "OCT-NOV 26" (the first month), "LH SEPT
     CORN 26". A parenthesised "(2026-12)" is the board's futures month, not
     the delivery, and is dropped. A month with no year ("NOVEMBER", "DEC
     CORN") takes the year of the day it was logged, or the next year when it
     is well behind it. Twin of parse_dm() in scripts/build_cash_bid_pages.py. */
  var MON_RE = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:[A-Z]*)\b/;
  function parseDm(s, date) {
    var t = String(s || '').toUpperCase().replace(/\([^)]*\)/g, ' ').trim(), m, mi, y;
    if ((m = /^(\d{1,2})\/\d{1,2}\/(\d{4})\b/.exec(t))) { mi = +m[1] - 1; return mi >= 0 && mi < 12 ? m[2] + '-' + pad2(mi + 1) : null; }
    if ((m = /^([A-Z]{3})(\d{2})$/.exec(t)) && (mi = MM.indexOf(m[1])) >= 0) return '20' + m[2] + '-' + pad2(mi + 1);
    if (!(m = MON_RE.exec(t))) return null;
    mi = MM.indexOf(m[1]);
    var rest = t.slice(m.index + m[0].length);
    if ((y = /\b(20\d{2})\b/.exec(rest))) return y[1] + '-' + pad2(mi + 1);
    if ((y = /(?:^|[\s'-])(\d{2})\b(?!\s*,)/.exec(rest)) && !/^\s*\d{1,2}\s*,/.test(rest)) return '20' + y[1] + '-' + pad2(mi + 1);
    var yr = +date.slice(0, 4), dmon = +date.slice(5, 7) - 1;
    if (mi < dmon - 2) yr += 1;
    return yr + '-' + pad2(mi + 1);
  }
  /* The futures contract a basis is quoted against: "Dec '26", or '' when
     the board named none. */
  function contractOf(s) {
    var t = String(s || '').toUpperCase().trim(), m, mi;
    if ((m = /^(?:ZC|ZS|KE|ZW|MWO|MW)([FGHJKMNQUVXZ])(\d{1,2})$/.exec(t))) return MON[CODES.indexOf(m[1])] + " '" + (m[2].length === 1 ? '2' + m[2] : m[2]);
    if ((m = /^([A-Z]{3})[A-Z]*\s+'?(\d{2})\b/.exec(t)) && (mi = MM.indexOf(m[1])) >= 0) return MON[mi] + " '" + m[2];
    return '';
  }
  /* the log's run time -> its day in Central time, the network's day (Nov 13, 2026: a run at 02:02 UTC on Nov 13 is the
     evening of Nov 12; the box named a day that had not started). US DST rule, no Intl needed under node. */
  function ctDay(iso) {
    var t = new Date(iso); if (isNaN(t)) return String(iso || '').slice(0, 10);
    var y = t.getUTCFullYear(), a = Date.UTC(y, 2, 8 + (7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7, 8), b = Date.UTC(y, 10, 1 + (7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7, 7);
    return new Date(t.getTime() - (t.getTime() >= a && t.getTime() < b ? 5 : 6) * 36e5).toISOString().slice(0, 10);
  }
  function dayText(d) { return MON[+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)); }
  function fullDay(d) { return dayText(d) + ', ' + d.slice(0, 4); }
  function monText(dm) { return MON[+dm.slice(5, 7) - 1] + (dm.slice(0, 4) === REF_YEAR ? '' : ' ' + dm.slice(0, 4)); }
  function basisText(c) { return c === 0 ? 'even' : (c < 0 ? '−' : '+') + Math.abs(c) + '¢'; }

  /* -> [{date, cents, dm, con}]: the nearest-delivery basis at each change,
     a point only where the basis, the month or the contract changed, and
     {date, gap: true, dm} from a date when no open month had a logged value. endDate
     ('YYYY-MM-DD', the log's last run) lets a month that opened since the last
     change take over. */
  function nearestSeries(keys, endDate) {
    if (!keys.length) return [];
    var dates = {};
    keys.forEach(function (k) { k.pts.forEach(function (p) { dates[p.date] = 1; }); });
    var ds = Object.keys(dates).sort();
    /* the first of each month through the log's last run, so a month that rolls off is seen */
    var y = +ds[0].slice(0, 4), m = +ds[0].slice(5, 7), last = ds[ds.length - 1];
    if (endDate && endDate > last) last = endDate;
    for (;;) { m++; if (m > 12) { m = 1; y++; } var f = y + '-' + pad2(m) + '-01'; if (f > last) break; dates[f] = 1; }
    ds = Object.keys(dates).sort();
    var out = [];
    ds.forEach(function (d) {
      var mon = d.slice(0, 7), best = null;
      keys.forEach(function (k) {
        var dm = k.dmOf(d);
        if (!dm || dm < mon) return;
        var v = null, at = '';
        for (var i = 0; i < k.pts.length && k.pts[i].date <= d; i++) { v = k.pts[i].cents; at = k.pts[i].date; }
        if (v == null) return;
        if (!best || dm < best.dm || (dm === best.dm && at > best.at)) best = { dm: dm, at: at, cents: v, con: k.con };
      });
      var p = out[out.length - 1];
      /* no month on or after this date has a logged value yet: a gap, never the old month carried on */
      if (!best) { if (p && !p.gap) out.push({ date: d, gap: true, dm: mon }); return; }
      if (p && !p.gap && p.cents === best.cents && p.dm === best.dm && p.con === best.con) return;
      out.push({ date: d, cents: best.cents, dm: best.dm, con: best.con });
    });
    return out;
  }

  function keysFor(data, fac, cities, crop) {
    var want = normFac(fac), cs = {};
    cities.forEach(function (c) { cs[normKey(c)] = 1; });
    var out = [];
    Object.keys(data.series || {}).forEach(function (key) {
      var p = key.split('|');
      if (p.length < 6 || p[3] !== crop || normFac(p[1]) !== want || !cs[normKey(p[2])]) return;
      var pts = (data.series[key] || []).filter(function (x) { return x && typeof x.cents === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(x.date); })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      if (!pts.length) return;
      var raw = p[5];
      out.push({ pts: pts, con: contractOf(p[4]), dmOf: function (d) { return parseDm(raw, d); } });
    });
    return out;
  }

  /* ONE CHART PER CROP (Nov 12, 2026; E51, the shared chart kit components/ag-chart.js). Every elevator in the
     town with a logged basis for the crop is a line in one chart, so they share one scale and one time span by
     construction (the Nov 4 panel rule). Each line is a step (a basis holds flat until its next change) held to
     the log's last run, named at its right end with its basis now; a stretch when no open delivery month had a
     logged basis is a gap; a thin mark is where the delivery month or the futures contract changed. The
     headline and takeaway are computed from the range shown; a change is only ever counted on one delivery
     month and one contract. At most LINES_MAX lines (LINES_NARROW on a narrow phone; the best basis now); every elevator keeps its table. */
  /* The site's own inks (the kit's page colours are CSS variables, the picture's are these): gold, green, blue, rust, slate,
     each with its own dash so the lines survive colour blindness and print. A dotted stretch is a gap. */
  var LINES_MAX = 5, ADJ = { corn: 'corn', soybeans: 'soybean', wheat: 'wheat' }, CW = { corn: 'corn', soybeans: 'soybeans|beans', wheat: 'wheat' };
  var PAL = ['#d4a23f', '#5fc28a', '#6f9fc2', '#d9774f', '#a7b6bd'];
  var DASH = ['', '14 6', '7 4', '14 4 3 4', '4 3 12 3'];
  var FULL_MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function hy(s) { return String(s || '').replace(/(\w)-(?=\w)/g, '$1\u2010'); }   /* the kit's true hyphen, printed before it draws so nothing changes when it does */
  function dayBefore(d) { return new Date(Date.parse(d) - 864e5).toISOString().slice(0, 10); }
  /* One name per board, every word spelled out: the company and the site it posts for ("Mid-Iowa Cooperative, Cargill
     Iowa Falls"), by elevNames.boardLabel (components/elev-names.js). No two boards share one: a repeat is told apart
     by the places as the network printed them, then by a number. -> one label per board, in order */
  function labels(boards, town, st) {
    var out = boards.map(function (b) { return names().boardLabel ? names().boardLabel(b[0], b[1] || [], town, st) : String(b[0] || ''); }), n = {};
    out.forEach(function (l) { n[l] = (n[l] || 0) + 1; });
    out = out.map(function (l, i) { return n[l] > 1 ? l + ' (' + (boards[i][1] || []).join(', ') + ')' : l; });
    n = {}; out.forEach(function (l) { n[l] = (n[l] || 0) + 1; });
    var k = {}; return out.map(function (l) { if (n[l] < 2) return l; k[l] = (k[l] || 0) + 1; return l + ' (listing ' + k[l] + ')'; });
  }
  function conWords(cons, crop) {   /* ["Mar '27"] -> "March 2027 corn futures"; two -> "November 2026 and January 2027 soybean futures" */
    var w = [].concat(cons).map(function (con) { var m = /^([A-Z][a-z]{2}) '(\d{2})$/.exec(con || ''), i = m ? MON.indexOf(m[1]) : -1; return i < 0 ? '' : FULL_MON[i] + ' 20' + m[2]; }).filter(Boolean);
    return w.length ? w.join(w.length > 2 ? ', ' : ' and ') + ' ' + crop + ' futures' : '';
  }
  function fullMon(dm) { return FULL_MON[+dm.slice(5, 7) - 1] + (dm.slice(0, 4) === REF_YEAR ? '' : ' ' + dm.slice(0, 4)); }
  /* nearestSeries() rows -> the kit's points: b on the first value after a gap (the day the gap began), m where
     the month or contract changed; until: held to the log's last run, or to the day before a gap at the end */
  function lineOf(pts, end) {
    var points = [], gapFrom = null, prev = null;
    pts.forEach(function (p) {
      if (p.gap) { gapFrom = p.date; return; }
      var q = { d: p.date, v: p.cents, dm: p.dm, con: p.con };
      if (gapFrom && prev) q.b = gapFrom;
      else if (prev && (prev.dm !== p.dm || prev.con !== p.con)) {
        q.m = true;
        q.ml = prev.dm !== p.dm ? monText(p.dm) + ' delivery starts' : 'now vs ' + (/^[A-Z][a-z]{2}/.exec(p.con || '') || ['the next'])[0] + ' futures';
      }
      gapFrom = null; points.push(q); prev = q;
    });
    if (!points.length) return null;
    var last = points[points.length - 1].d, until = gapFrom ? dayBefore(gapFrom) : end;
    return { points: points, until: until > last ? until : '', tailGap: gapFrom || '' };
  }
  /* -> [{ crop, label, lines: [{ key, name, full, line }], hidden, end, from }] */
  function crops(data, boards, town, max, st) {
    max = max || LINES_MAX;
    var end = ctDay(data.generated), out = [], lab = labels(boards, town, st), sn = (names().states || {})[String(st || '').toUpperCase()];
    var place = town ? town + (sn ? ', ' + sn : '') : '';
    CROPS.forEach(function (c) {
      var lines = [];
      boards.forEach(function (b, i) {
        var pts = nearestSeries(keysFor(data, b[0], b[1] || [], c[0]), end), ln = pts.length && lineOf(pts, end);
        if (ln) lines.push({ key: 'e' + i, name: lab[i], long: lab[i], full: lab[i], rows: pts, line: ln });
      });
      lines.forEach(function (l) {   // a chart of one crop needs no crop word: "Cargill Cedar Rapids (soybeans)" or "Cargill Cedar Rapids-Soybeans" on a soybean chart is "Cargill Cedar Rapids"
        var n = l.name.replace(new RegExp('(?: \\((?:' + CW[c[0]] + ')\\)|-(?:' + CW[c[0]] + '))(?= and |$)', 'gi'), '');
        if (n !== l.name && !lines.some(function (o) { return o !== l && o.name === n; })) l.name = l.long = l.full = n;
      });
      if (!lines.length) return;
      var now = function (l) { return l.line.tailGap ? -1e9 : l.line.points[l.line.points.length - 1].v; };
      lines.sort(function (a, b) { return now(b) - now(a); });
      out.push({ crop: c[0], label: c[1], lines: lines.slice(0, max), all: lines, hidden: Math.max(0, lines.length - max), end: end, place: place });
    });
    return out;
  }
  function upTo(l, d) { var p = null; l.line.points.forEach(function (q) { if (q.d <= d) p = q; }); return p; }
  /* the basis a line held on day d, or null (not logged yet, or in a gap) */
  function heldOn(l, d) {
    var p = upTo(l, d), pts = l.line.points, nx = p && pts[pts.indexOf(p) + 1];
    if (!p || (nx && nx.b && d >= nx.b) || (l.line.tailGap && d >= l.line.tailGap)) return null;
    return p;
  }
  /* forCard: the picture's words (it has no tables below it) */
  function story(c, town, from, to, forCard) {
    var crop = ADJ[c.crop], Crop = crop.charAt(0).toUpperCase() + crop.slice(1), place = c.place || town, held = c.lines.map(function (l) { return { l: l, p: heldOn(l, to) }; }).filter(function (x) { return x.p; });
    if (!held.length) return { head: Crop + ' basis' + (place ? ' near ' + place : '') + ': nothing logged for an open month on ' + dayText(to), take: '', summary: '' };
    var head, take;
    if (c.lines.length === 1) {
      var l = held[0].l, pts = l.line.points, k = pts.indexOf(held[0].p), last = pts[k];
      while (k > 0 && !pts[k].b && !pts[k].m && pts[k - 1].d >= from) k--;
      var first = pts[k], ch = last.v - first.v, cw = conWords(last.con ? [last.con] : [], crop), ref = fullMon(last.dm) + ' delivery' + (cw ? ', against ' + cw : '');
      if (first !== last) {
        head = Crop + ' basis at ' + l.long + (ch ? (ch > 0 ? ' firmed ' : ' weakened ') + Math.abs(ch) + '¢' : ' held at ' + basisText(last.v)) + ' since ' + dayText(first.d);
        take = basisText(last.v) + ' on ' + dayText(to) + ', from ' + basisText(first.v) + '. ' + ref + '. Counted on one delivery month and one contract.';
      } else {
        head = Crop + ' basis at ' + l.long + ': ' + basisText(last.v);
        take = ref + '. Unchanged since ' + dayText(last.d) + '. A basis holds until the elevator changes it.';
      }
    } else {
      held.sort(function (a, b) { return b.p.v - a.p.v; });
      var best = held[0], lo = held[held.length - 1].p.v, ties = held.filter(function (x) { return x.p.v === best.p.v; }).length;
      head = 'Best ' + crop + ' basis' + (place ? ' near ' + place : '') + ': ' + basisText(best.p.v) + ' at ' + (ties > 1 ? ties + ' elevators' : best.l.long);
      var shown = c.lines.length + ' of ' + c.all.length + ' elevators shown.' + (c.hidden && !forCard ? ' Every one is in the tables below.' : '');
      var cons = {}; held.forEach(function (x) { if (x.p.con) cons[x.p.con] = 1; }); cons = Object.keys(cons).sort(function (x, y) { return x.slice(-2) + MON.indexOf(x.slice(0, 3)) / 100 < y.slice(-2) + MON.indexOf(y.slice(0, 3)) / 100 ? -1 : 1; });
      var cw = conWords(cons, crop);
      take = (best.p.v === lo ? (held.length === 2 ? 'Both' : 'All ' + held.length) + ' elevators at ' + basisText(lo) : held.length + ' elevators from ' + basisText(lo) + ' to ' + basisText(best.p.v)) +
        ' on ' + dayText(to).replace(' ', '\u00a0') + ', each for its nearest delivery month' + (cw ? ', against ' + cw : '') + '.' + ' ' + shown;
    }
    return { head: head, take: take, summary: head + '. ' + take };
  }
  /* the words under the chart: only what is drawn in it */
  /* The note under the chart names only what is drawn in the view shown (v: the kit's slice; none: the whole log): a gap
     whose stretch is in view, a dotted line in view, a first bid logged inside the view, a tie on a day in view. */
  function footOf(c, v) {
    var from = v ? v.from : '', to = v ? v.to : c.end, pts = function (l) { var s = v && v.series.filter(function (q) { return q.key === l.key; })[0]; return s ? s.points : v ? [] : l.line.points; };
    var gaps = false, marks = {}, first = '', ties = false, late = [], days = {};
    c.lines.forEach(function (l) {
      var ps = pts(l);
      ps.forEach(function (p, i) { if (p.b && i) gaps = true; if (p.m) marks[p.d] = 1; days[p.d] = 1; });
      if (!first || l.line.points[0].d < first) first = l.line.points[0].d;
    });
    c.lines.forEach(function (l) { var d0 = l.line.points[0].d; if (d0 > dayAfter(first, 1) && d0 > from && d0 <= to) late.push({ d: d0, t: l.name + ' ' + dayText(d0) }); });
    late = late.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.t < b.t ? -1 : 1; }).map(function (x) { return x.t; });
    Object.keys(days).concat(to).forEach(function (d) { if (d < from) return; var by = {}; c.lines.forEach(function (l) { var p = heldOn(l, d); if (p) by[p.v] = (by[p.v] || 0) + 1; }); Object.keys(by).forEach(function (x) { if (by[x] > 1) ties = true; }); });
    var n = Object.keys(marks).length;
    return [gaps ? 'Thin dashed line: no bid posted.' : '', n ? (n === 1 ? 'Dotted vertical line: ' : 'Dotted vertical lines: ') + 'the delivery month or futures contract changed.' : '',
      ties ? 'Lines at the same value are drawn side by side.' : '', late.length ? 'First bid logged: ' + late.join('; ') + '.' : ''].filter(Boolean).join(' ');
  }
  function dayAfter(d, n) { return new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10); }
  function config(c, town, els, url, since) {
    var slug = String(town || 'town').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), place = c.place || town || '', Crop = ADJ[c.crop].replace(/^./, function (x) { return x.toUpperCase(); });
    var all = since ? 'Since ' + dayText(since) : 'All logged days', byKey = {};
    c.lines.forEach(function (l) { byKey[l.key] = l; });
    return {
      series: c.lines.map(function (l, i) { return { key: l.key, name: l.name, points: l.line.points, until: l.line.until, step: true, dash: DASH[i % DASH.length], color: 'var(--cbh' + (i % 5 + 1) + ')', card: PAL[i % 5] }; }),
      gaps: 1e6, ownGaps: true, minPoints: 1, pad: 2, unit: '¢/bu', axisTitle: 'Basis vs futures, ¢/bu', fmt: basisText, tick: basisText,
      legend: true, intTicks: true, fixedTicks: true, weekly: true, clip: true, gapNote: 'no bid posted', markMany: 'Delivery month changed',
      markLabel: function (p) { return p.ml || ''; },
      valueAt: function (key, d) { var p = byKey[key] && heldOn(byKey[key], d); return p ? basisText(p.v) : ''; },
      keyNote: '· touch the chart for another day',
      foot: function (v) { return footOf(c, v); },
      ranges: [{ label: '2 weeks', days: 14, aria: 'two weeks' }, { label: '1 month', days: 31, aria: 'one month' }, { label: all, days: 0, aria: 'every day logged' }],
      range: all, height: { phone: 250, wide: 300 },
      story: function (v, forCard) { return story(c, town, v.from, v.to, forCard); },
      readout: function (v, d) {
        // each "name basis" holds together (no-break spaces and hyphens) and a line breaks only after a separator
        var t = c.lines.map(function (l) { var p = heldOn(l, d); return p ? (l.name + ' ' + basisText(p.v)).replace(/ /g, '\u00a0').replace(/(\w)-(?=\w)/g, '$1\u2011') : ''; }).filter(Boolean);
        return dayText(d) + ': ' + (t.length ? t.join('\u00a0· ') : 'nothing logged for an open month');
      },
      headEl: els.head, takeEl: els.take, tools: els.tools,
      share: { url: url, title: ADJ[c.crop] + ' basis' + (place ? ' near ' + place : ''), file: 'agsist-basis-' + slug + '-' + c.crop + '.png',
               kicker: (place ? place + ' · ' : '') + ADJ[c.crop] + ' basis', source: 'Source: posted elevator bids, logged by AGSIST' + (since ? ', since ' + fullDay(since) : ''), date: c.end }
    };
  }
  function table(l) {
    var pts = l.rows, rows = pts.slice(-TABLE_MAX).reverse().map(function (p) {
      if (p.gap) return '<tr><td>' + dayText(p.date) + '</td><td>' + monText(p.dm) + '</td><td class="n cbh-mut">none</td><td><span class="cbh-mut">not logged</span></td></tr>';
      return '<tr><td>' + dayText(p.date) + '</td><td>' + monText(p.dm) + '</td><td class="n">' + basisText(p.cents) + '</td><td>' + (p.con ? esc(p.con) : '<span class="cbh-mut">not named</span>') + '</td></tr>';
    }).join(''), n = pts.length - TABLE_MAX;
    return '<h4 class="cbh-h4">' + esc(l.full) + '</h4><div class="cbh-scroll"><table class="cbh-t"><thead><tr><th>Changed</th><th>Delivery</th><th class="n">Basis</th><th>vs futures</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (n > 0 ? '<p class="cbh-mut">' + n + ' earlier ' + (n === 1 ? 'row is' : 'rows are') + ' in the chart above.</p>' : '');
  }
  function blockOf(c, town, i) {
    var lo = c.lines.reduce(function (a, l) { return l.line.points[0].d < a ? l.line.points[0].d : a; }, c.end), st = story(c, town, lo, c.end);
    return '<div class="cbh-crop" data-crop="' + i + '"><h3 class="cbh-h">' + esc(hy(st.head)) + '</h3><p class="cbh-l">' + esc(hy(st.take)) + '</p>' +
      '<div class="cbh-kit"></div><div class="agc-tools cbh-tools"></div>' +
      '<details class="cbh-more"><summary>Every change, elevator by elevator</summary>' + c.all.map(table).join('') + '</details></div>';
  }

  var kitReady = null;
  function needKit() {
    if (typeof window === 'undefined') return Promise.resolve(null);
    if (window.AgChart) return Promise.resolve(window.AgChart);
    if (!kitReady) kitReady = new Promise(function (ok) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/components/ag-chart.css?v=4'; document.head.appendChild(l);
      var sc = document.createElement('script'); sc.src = '/components/ag-chart.js?v=5';
      sc.onload = function () { ok(window.AgChart || null); }; sc.onerror = function () { ok(null); };
      document.head.appendChild(sc);
    });
    return kitReady;
  }

  /* a page built before it carried data-town: the town is the one place every board lists */
  function townOf(boards) {
    var c = ((boards[0] || [])[1] || []).filter(function (p) { return boards.every(function (b) { return (b[1] || []).some(function (q) { return normKey(q) === normKey(p); }); }); });
    return c.length === 1 ? c[0] : '';
  }
  function render(box, data) {
    var body = box.querySelector('.cbt-hist-body');
    var boards = [];
    try { boards = JSON.parse(box.getAttribute('data-boards') || '[]'); } catch (e) { boards = []; }
    if (!data || !data.series) { body.innerHTML = '<p class="cbt-sub">The basis log could not be loaded. Try again later.</p>'; return []; }
    var end = ctDay(data.generated), town = box.getAttribute('data-town') || townOf(boards);
    var from = /^\d{4}-\d{2}-\d{2}$/.test(String(data.publicFrom || '')) ? data.publicFrom : '';
    if (/^\d{4}/.test(end)) REF_YEAR = end.slice(0, 4);
    var st = String(box.getAttribute('data-basis-hist') || '').toUpperCase();
    var cs = crops(data, boards, town, LINES_MAX, st), first = '', got = {};
    cs.forEach(function (c) { c.all.forEach(function (l) { got[l.full] = 1; if (!first || l.rows[0].date < first) first = l.rows[0].date; }); });
    var lab = labels(boards, town, st), none = boards.map(function (b, i) { return lab[i]; }).filter(function (l) { return !got[l]; });
    var since = from ? fullDay(from) : (first ? dayText(first) : '');
    var intro = '<p class="cbt-sub">Basis for the nearest delivery month on each date' + (since ? ', since ' + since : '') +
      '. Only the days a basis changed are logged: it held flat between dots. A thin dashed stretch is the days no open delivery month had a logged basis. A dotted vertical line is where the delivery month or the futures contract changed, so the step there is partly a new reference, not only a new price. Every elevator for a crop is in one chart, on one scale. Each name is the company, then the place it posts for. A bid far off the others for a few days is drawn in a break under the chart and named, so the rest stay readable.</p>';
    var html = intro + cs.map(function (c, i) { return blockOf(c, town, i); }).join('');
    if (none.length) html += '<p class="cbt-sub">No basis change logged' + (since ? ' since ' + since : '') + ' for ' + esc(none.join(', ')) + '.</p>';
    body.innerHTML = html;
    cs.forEach(function (c, i) {   // a phone's box holds the key's rows from the first paint, so nothing moves when the kit draws
      var kit = body.querySelector && body.querySelector('.cbh-crop[data-crop="' + i + '"] .cbh-kit');
      if (kit && kit.clientWidth && kit.clientWidth < 720) kit.style.minHeight = (40 + 250 + 60 + 49 * c.lines.length + 70) + 'px';
    });
    var sum = box.querySelector('summary');
    if (sum && since) sum.textContent = 'Basis since ' + since;
    if (box.ownerDocument) needKit().then(function (K) {
      if (!K) return;
      var canon = box.ownerDocument.querySelector('link[rel="canonical"]'), url = canon ? canon.href : String(location.href).split('#')[0];
      cs.forEach(function (c, i) {
        var bl = body.querySelector('.cbh-crop[data-crop="' + i + '"]');
        var kit = bl.querySelector('.cbh-kit');
        K.mount(kit, config(c, town, { head: bl.querySelector('.cbh-h'), take: bl.querySelector('.cbh-l'), tools: bl.querySelector('.cbh-tools') }, url, from || first));
      });
    });
    return cs;
  }
  function open(box) {
    if (box.getAttribute('data-loaded')) return;
    box.setAttribute('data-loaded', '1');
    var st = String(box.getAttribute('data-basis-hist') || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(st)) return;
    box.querySelector('.cbt-hist-body').innerHTML = '<p class="cbt-sub">Loading the basis log&hellip;</p>';
    if (!cache[st]) cache[st] = fetch('/data/basis-sparklines/' + st + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([cache[st], needNames()]).then(function (r) { render(box, r[1] ? r[0] : null); });
  }

  var css = '.cbh-crop{margin:12px 0 4px;padding-top:10px;border-top:1px solid var(--border);--cbh1:#d4a23f;--cbh2:#5fc28a;--cbh3:#6f9fc2;--cbh4:#d9774f;--cbh5:#a7b6bd}' +
    '[data-theme="light"] .cbh-crop{--cbh1:#8a6514;--cbh2:#2e7d4f;--cbh3:#2a6390;--cbh4:#a8431f;--cbh5:#4f5f68}' +
    '.cbh-kit{min-height:400px}@container (min-width:720px){.cbh-kit{min-height:440px}}.cbh-crop{container-type:inline-size}' +
    '.cbh-tools{min-height:34px;margin:.3rem 0}.cbh-more summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--gold,#d4a23f);font-weight:600;font-size:.86rem}.cbh-h4{margin:10px 0 2px;font-size:.86rem}' +
    '.cbh-h{margin:0 0 2px;font-size:1.02rem;font-weight:800;line-height:1.3}.cbh-l{margin:0 0 6px;font-size:.88rem;line-height:1.5;color:var(--text)}' +
    '.cbh-scroll{overflow-x:auto}.cbh-t{width:100%;border-collapse:collapse;font-size:.82rem}' +
    '.cbh-t th{text-align:left;color:var(--text-muted);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;padding:4px 6px;border-bottom:1px solid var(--border)}' +
    '.cbh-t td{padding:4px 6px;border-bottom:1px solid var(--border);color:var(--text);white-space:nowrap}' +
    '.cbh-t .n{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}.cbh-mut{color:var(--text-dim);font-size:.8rem}';

  function init() {
    var boxes = document.querySelectorAll('details[data-basis-hist]');
    if (!boxes.length) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    Array.prototype.forEach.call(boxes, function (box) {
      if (box.open) open(box);
      box.addEventListener('toggle', function () { if (box.open) open(box); });
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ctDay: ctDay, normFac: normFac, normKey: normKey, parseDm: parseDm, contractOf: contractOf, nearestSeries: nearestSeries, keysFor: keysFor, basisText: basisText, lineOf: lineOf, crops: crops, story: story, config: config, heldOn: heldOn, labels: labels, townOf: townOf, footOf: footOf, render: render };
  } else if (document.readyState === 'loading') {
    window.CbBasisHist = { crops: crops, heldOn: heldOn, labels: labels, normFac: normFac, normKey: normKey };   // the town page's month view (components/basis-month.js) reads the log the same way
    document.addEventListener('DOMContentLoaded', init);
  } else { window.CbBasisHist = { crops: crops, heldOn: heldOn, labels: labels, normFac: normFac, normKey: normKey }; init(); }
})();
