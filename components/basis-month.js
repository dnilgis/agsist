/* components/basis-month.js: "Since Oct 12", the second view of the town page's bids-by-distance box (Nov 13, 2026).
 *
 * The month in one band. A grey band runs from the lowest to the highest bid in town on each day; its top edge, the
 * best bid in town that day, is the one accent line. Every elevator's own line is hidden until its name is pressed.
 * At the right edge a bracket shows the state today (its middle bid and its range) on the same axis.
 *
 * The log is data/basis-sparklines/<ST>.json, read exactly as the old history chart read it (components/
 * cb-basis-hist.js: each elevator's basis for its nearest open delivery month on each day, a step that holds until it
 * changes). A bid more than 30 cents from the middle of the others on a day (three or more posting) is kept out of the
 * band and named under it. Nothing is interpolated or carried past the log's last run.
 *
 * Loaded by components/basis-drive.js the first time the view is asked for. window.BasisMonth.mount(el, opts) ->
 * { crop(c), save(url) }. Exports model() and svg() for node.
 */
(function (root) {
  'use strict';
  var BD = root.BasisDrive || (typeof require === 'function' ? require('./basis-drive.js') : null);
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var STRAY = 30;
  var ADJ = { corn: 'corn', soybeans: 'soybean', wheat: 'wheat' };
  var FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /* "Jan '27" -> "January" */
  function conWord(con) { var i = MON.indexOf(String(con || '').slice(0, 3)); return i < 0 ? '' : FULL[i]; }
  function word(c) { return BD.word(c); }
  function esc(s) { return BD.esc(s); }
  function f1(v) { return BD.f1(v); }
  function dd(d) { return MON[+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)); }
  function addDay(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
  /* a UTC time -> its day in Central time, the network's day (BasisDrive.ct) */
  function ctDay(iso) { var t = BD.ct(new Date(iso)); return t.y + '-' + (t.m < 9 ? '0' : '') + (t.m + 1) + '-' + (t.d < 10 ? '0' : '') + t.d; }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  /* c: one crop from CbBasisHist.crops(); held(l, d): CbBasisHist.heldOn. today: the town's bids the distance view
     draws ({ d: 'YYYY-MM-DD' in Central time, hi, lo, n, top: [names] }), which stand for the last day, so the two views
     of one box agree on it (round 2: the log's UTC stamp named a Nov 13 that had not started, counted a relay, and
     rounded a half cent apart from the table). -> the band, day by day, and the story */
  function model(c, held, town, from, today) {
    var lines = c.all, end = today && today.d ? today.d : c.end, first = '', adj = ADJ[c.crop];
    lines.forEach(function (l) { var d0 = l.line.points[0].d; if (!first || d0 < first) first = d0; });
    if (from && from > first) first = from;
    /* the futures month most lines hold on the last day: the headline compares only bids on it */
    var conN = {}; lines.forEach(function (l) { var p = held(l, end); if (p && p.con) conN[p.con] = (conN[p.con] || 0) + 1; });
    var refCon = Object.keys(conN).sort(function (a, b) { return conN[b] - conN[a] || (a < b ? -1 : 1); })[0] || '';
    var days = [], strays = {};
    for (var d = first; d <= end; d = addDay(d, 1)) {
      var vs = lines.map(function (l) { var p = held(l, d); return p ? { l: l, v: p.v, con: p.con, dm: p.dm } : null; }).filter(Boolean);
      var keep = vs;
      if (vs.length >= 3) {
        var md = median(vs.map(function (x) { return x.v; }));
        keep = vs.filter(function (x) { var far = Math.abs(x.v - md) > STRAY; if (far) (strays[x.l.key] = strays[x.l.key] || { l: x.l, v: [], d: [] }).v.push(x.v), strays[x.l.key].d.push(d); return !far; });
      }
      if (!keep.length) { days.push({ d: d, gap: true }); continue; }
      var hi = Math.max.apply(null, keep.map(function (x) { return x.v; })), lo = Math.min.apply(null, keep.map(function (x) { return x.v; }));
      var same = keep.filter(function (x) { return !refCon || x.con === refCon; });
      days.push({ d: d, hi: hi, lo: lo, n: keep.length, top: keep.filter(function (x) { return x.v === hi; }).map(function (x) { return x.l.name; }), all: vs,
                  hiR: same.length ? Math.max.apply(null, same.map(function (x) { return x.v; })) : null, keys: keep.map(function (x) { return x.l.key; }) });
    }
    if (today && today.n && days.length && days[days.length - 1].d === end) { var pv = days[days.length - 1]; days[days.length - 1] = { d: end, hi: today.hi, lo: today.lo, n: today.n, top: today.top, all: [], hiR: today.hi, keys: pv.keys || [] }; }
    /* the changeovers: a day when two or more lines (or three in ten posting) moved to a new delivery month or a new
       futures month. They are marked on the picture; the headline never compares across a futures change, nor across a
       delivery change that moved the best bid 5 cents or more that day (round 3: soybeans "rose" 30 cents because
       October delivery closed and January futures took over) */
    var ch = {};
    lines.forEach(function (l) {
      var pts = l.line.points;
      pts.forEach(function (p, i) {
        if (!p.m || !i || p.d < first || p.d > end) return;
        var q = pts[i - 1];
        if (q.dm !== p.dm) { var k1 = p.d + '|dm|' + p.dm; ch[k1] = (ch[k1] || 0) + 1; }
        if (q.con !== p.con) { var k2 = p.d + '|con|' + p.con; ch[k2] = (ch[k2] || 0) + 1; }
      });
    });
    var marks = [], posting = function (d) { var x = days.filter(function (z) { return z.d === d; })[0]; return x && !x.gap ? x.n : 0; };
    Object.keys(ch).sort().forEach(function (k) {
      var a = k.split('|'), n = ch[k];
      if (n < 2 && n < 0.3 * posting(a[0])) return;
      marks.push({ d: a[0], kind: a[1], to: a[2], n: n, text: a[1] === 'dm' ? FULL[+a[2].slice(5, 7) - 1] + ' delivery from ' + dd(a[0]) : conWord(a[2]) + ' futures from ' + dd(a[0]) });
    });
    var start = first;
    marks.forEach(function (mk) {
      var i = days.map(function (x) { return x.d; }).indexOf(mk.d), b4 = i > 0 ? days[i - 1] : null, at = days[i];
      var jump = b4 && at && !b4.gap && !at.gap && b4.hiR != null && at.hiR != null ? Math.abs(at.hiR - b4.hiR) : 0;
      if ((mk.kind === 'con' && mk.to === refCon) || (mk.kind === 'dm' && jump >= 5)) { if (mk.d > start) start = mk.d; mk.cut = true; }
    });
    /* from the cut on, the band holds only bids on the headline's futures month, so its top edge is the headline's best;
       a line still on another futures month leaves it and is named (round 4: Linn Co-op on November futures drew the
       gold line at 11 under under a headline about January futures) */
    var off = {};
    if (start > first) days.forEach(function (x, i) {
      if (x.gap || x.d < start || !x.all.length) return;
      var on = x.all.filter(function (z) { return z.con === refCon && (!strays[z.l.key] || strays[z.l.key].d.indexOf(x.d) < 0); });
      x.all.forEach(function (z) { if (z.con !== refCon) (off[z.l.key] = off[z.l.key] || { name: z.l.name, con: z.con }); });
      if (!on.length) { days[i] = { d: x.d, gap: true }; return; }
      var h2 = Math.max.apply(null, on.map(function (z) { return z.v; }));
      days[i] = { d: x.d, hi: h2, lo: Math.min.apply(null, on.map(function (z) { return z.v; })), n: on.length, top: on.filter(function (z) { return z.v === h2; }).map(function (z) { return z.l.name; }), all: x.all, hiR: h2, keys: on.map(function (z) { return z.l.key; }) };
    });
    var offList = Object.keys(off).map(function (k) { return off[k]; });
    var win = days.filter(function (x) { return !x.gap && x.d >= start && x.hiR != null; });
    var keysIn = {}; days.forEach(function (x) { if (!x.gap && x.d >= start) (x.keys || []).forEach(function (k) { keysIn[k] = 1; }); });
    var nIn = Object.keys(keysIn).length || lines.length;
    var sl = Object.keys(strays).map(function (k) { var s = strays[k], a = s.d[0], b = s.d[s.d.length - 1]; return s.l.name + ' at ' + word(s.v[0]) + (a === b ? ', ' + dd(a) : ', ' + dd(a) + ' to ' + dd(b)); });
    if (!win.length) return { lines: lines, days: days, marks: marks, head: 'No ' + adj + ' basis logged in ' + town + ' since ' + dd(first), take: '', first: first, end: end, strays: sl, start: start, n: 0 };
    var logged = days.filter(function (x) { return !x.gap; });
    if (logged.length < 3) {
      var last = logged[logged.length - 1];
      return { lines: lines, days: days, marks: [], short: true, head: 'Logged since ' + dd(logged[0].d) + ': ' + word(last.hi) + '. Too short to chart yet.', take: '', cardTake: '', first: first, end: end, strays: sl, start: start, n: last.n, off: [] };
    }
    var now = win[win.length - 1], mn = win[0], mx = win[0], st0 = win[0];
    win.forEach(function (x) { if (x.hiR < mn.hiR) mn = x; if (x.hiR > mx.hiR) mx = x; });
    // after a changeover the sentence opens on the stretch it compares: "Since Nov 2, on January futures, the best ..."
    var rise = now.hiR - mn.hiR, fall = mx.hiR - now.hiR, head, cut = start > first;
    var base = (cut ? 'Since ' + dd(start) + (conWord(refCon) ? ', on ' + conWord(refCon) + ' futures, the' : ', the') : 'The') + ' best ' + adj + ' bid in ' + town, since = '';
    if (mn !== st0 && mn !== now && Math.abs(now.hiR - st0.hiR) <= 5 && st0.hiR - mn.hiR >= 5 && now.hiR - mn.hiR >= 5) head = base + ' fell to ' + word(mn.hiR) + ' on ' + dd(mn.d) + ' and is back to ' + word(now.hiR) + since + '.';
    else if (rise >= 3 && rise >= fall) head = base + ' rose from ' + word(mn.hiR) + ' on ' + dd(mn.d) + ' to ' + word(now.hiR) + ' now' + since + '.';
    else if (fall >= 3) head = base + ' fell from ' + word(mx.hiR) + ' on ' + dd(mx.d) + ' to ' + word(now.hiR) + ' now' + since + '.';
    else head = base + ' held between ' + word(mn.hiR) + ' and ' + word(mx.hiR) + (cut ? '.' : ' since ' + dd(win[0].d) + '.');
    // at most four lines on a phone (about 170 characters)
    var take = (nIn === 1 ? 'One elevator in town posting since ' + dd(start) + '; the gold line is its bid.' : 'Lowest to highest bid in town each day, ' + nIn + ' elevators posting since ' + dd(start) + '; top edge: the best.') +
      (marks.length ? ' Dotted lines: a new delivery or futures month.' : '') + (start === first && refCon && conWord(refCon) ? ' All on ' + conWord(refCon) + ' futures.' : '');
    var cardTake = nIn + (nIn === 1 ? ' elevator' : ' elevators') + ' posting since ' + dd(start) + (marks.length ? '. Dotted lines: a new delivery or futures month' : '') + (start > first ? '; only bids since ' + dd(start) + ', on the same terms, are compared.' : '.');
    return { lines: lines, days: days, marks: marks, off: offList, head: head, take: take, cardTake: cardTake, first: first, end: end, now: now, strays: sl, start: start, n: nIn, refCon: refCon };
  }

  /* -> { svg, x(d), day(px) } at W x H. opt: { card, fs, show: {key: 1}, state: {median, lo, hi, n, label, name}, hover } */
  function svg(m, W, H, opt) {
    opt = opt || {};
    var phone = W < 640, card = !!opt.card, fs = opt.fs || (phone ? 12 : 13), fb = fs + 1, live = m.days.filter(function (x) { return !x.gap; });
    var vals = []; live.forEach(function (x) { vals.push(x.hi, x.lo); });
    Object.keys(opt.show || {}).forEach(function (k) { m.lines.forEach(function (l) { if (l.key === k) l.line.points.forEach(function (p) { vals.push(p.v); }); }); });
    var stt = opt.state; if (stt) vals.push(stt.lo, stt.hi);
    if (!vals.length) vals = [0];
    var top = Math.ceil((Math.max.apply(null, vals) + 3) / 10) * 10, bot = Math.floor((Math.min.apply(null, vals) - 3) / 10) * 10;
    if (top - bot < 30) bot = top - 30;
    var stp = (top - bot) / 10 > (phone ? 6 : 9) ? 20 : 10; if (stp === 20) { top = Math.ceil(top / 20) * 20; bot = Math.floor(bot / 20) * 20; }
    var ticks = []; for (var v = top; v >= bot; v -= stp) ticks.push(v);
    // room at the top for the changeover names, clear of the best line (one band more where it runs too near the top)
    var nMk = (m.marks || []).length, maxHi = Math.max.apply(null, live.map(function (x) { return x.hi; }).concat(-1e9));
    if (nMk && (maxHi - bot) / (top - bot) > 1 - (nMk * fs * 1.3 + fs) / Math.max(1, H - fb * 1.6 - fs * 2.6)) { top += stp; ticks.unshift(top); }
    var L = Math.ceil(Math.max.apply(null, ticks.map(function (t) { return BD.widthOf(word(t), fs, t === 0); }))) + 10;
    var R = stt ? (phone ? Math.ceil(Math.max(BD.widthOf(word(stt.median), fs, true), BD.widthOf(stt.short, fs, true)) + 30) : Math.round(fs * 14)) : 12, y0 = Math.round(fb * 1.6), y1 = H - Math.round(fs * 2.6);
    var t0 = Date.parse(m.first), t1 = Date.parse(m.end), X = function (d) { return L + (Date.parse(d) - t0) / Math.max(864e5, t1 - t0) * (W - L - R - 8); };
    var Y = function (c) { return y0 + (top - c) / (top - bot) * (y1 - y0); };
    var o = [], P = { gr: [], ev: [] };
    var t = function (x, y, s, cls, anchor) { return '<text x="' + f1(x) + '" y="' + f1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + (cls ? ' class="' + cls + '"' : '') + '>' + esc(BD.hy(s)) + '</text>'; };
    /* every word is a box: the placer keeps the words on the data off each other, off the tick and date words, off the
       best line and inside the plot (round 4: names on the tick words and cut at the plot edge at 320) */
    var obst = [], labs = [], tw = function (x, y, s, bold, anchor) { var w = BD.widthOf(s, fs, bold), x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x; return { x0: x0 - 2, x1: x0 + w + 2, y0: y - fs, y1: y + 3 }; };
    ticks.forEach(function (c) { var y = Y(c); P[c === 0 ? 'ev' : 'gr'].push('M' + L + ' ' + f1(y) + 'H' + f1(W - R)); o.push(t(L - 8, y + fs * 0.36, word(c), c === 0 ? 'b' : 'm', 'end')); obst.push(tw(L - 8, y + fs * 0.36, word(c), c === 0, 'end')); });
    var PB = { x0: L + 2, x1: W - R - 2, y0: y0 - 2, y1: y1 + 2 }, inP = function (b) { return b.x0 >= PB.x0 && b.x1 <= PB.x1 && b.y0 >= PB.y0 && b.y1 <= PB.y1; };
    var free = function (b) { return inP(b) && !obst.concat(labs).some(function (z) { return BD.hit(z, b); }); };
    // the band and its top edge, a step that holds each day until the next; a day with nothing logged breaks both
    var runs = [], cur = null;
    m.days.forEach(function (x) { if (x.gap) { cur = null; return; } if (!cur) runs.push(cur = []); cur.push(x); });
    var band = '', topLine = '';
    runs.forEach(function (r) {
      var up = [], dn = [];
      r.forEach(function (x, i) { var xa = X(x.d), xb = i < r.length - 1 ? X(r[i + 1].d) : X(x.d); up.push([xa, Y(x.hi)], [xb, Y(x.hi)]); dn.push([xa, Y(x.lo)], [xb, Y(x.lo)]); });
      band += 'M' + up.map(function (p) { return f1(p[0]) + ' ' + f1(p[1]); }).join('L') + 'L' + dn.reverse().map(function (p) { return f1(p[0]) + ' ' + f1(p[1]); }).join('L') + 'Z';
      topLine += 'M' + up.map(function (p) { return f1(p[0]) + ' ' + f1(p[1]); }).join('L');
    });
    runs.forEach(function (r) { r.forEach(function (x, i) { var xa = X(x.d), xb = i < r.length - 1 ? X(r[i + 1].d) : X(x.d); obst.push({ x0: Math.min(xa, xb) - 1, x1: Math.max(xa, xb) + 1, y0: Y(x.hi) - 2, y1: Y(x.hi) + 2, line: 1 }); if (i) obst.push({ x0: xa - 2, x1: xa + 2, y0: Math.min(Y(x.hi), Y(r[i - 1].hi)), y1: Math.max(Y(x.hi), Y(r[i - 1].hi)), line: 1 }); }); });
    // an elevator's own line, when its name is pressed
    var own = '';
    m.lines.forEach(function (l) {
      if (!(opt.show || {})[l.key]) return;
      var d = '', prev = null;
      m.days.forEach(function (x, i) {
        var p = opt.held(l, x.d);
        if (!p) { prev = null; return; }
        var xa = X(x.d), xb = i < m.days.length - 1 ? X(m.days[i + 1].d) : X(x.d);
        d += (prev == null ? 'M' + f1(xa) + ' ' + f1(Y(p.v)) : 'L' + f1(xa) + ' ' + f1(Y(p.v))) + 'L' + f1(xb) + ' ' + f1(Y(p.v)); prev = p.v;
      });
      own += '<path class="bm-own" d="' + d + '"/>';
    });
    // the changeovers: a dotted rule each, named at the top of the plot (two rows where names would meet)
    var mk = '', named = 0;
    (m.marks || []).forEach(function (k) { var x = X(k.d); mk += '<path class="bm-mk" d="M' + f1(x) + ' ' + f1(y0) + 'V' + f1(y1) + '"/>'; obst.push({ x0: x - 1.5, x1: x + 1.5, y0: y0, y1: y1, rule: 1 }); });
    (m.marks || []).forEach(function (k) {
      var x = X(k.d), txts = phone ? [k.text.replace(/^(\w{3})\w* (delivery|futures) from (.*)$/, '$1 $2, $3')] : [k.text, k.text.replace(/^(\w{3})\w* (delivery|futures) from (.*)$/, '$1 $2, $3')];
      for (var ti = 0; ti < txts.length; ti++) {
        var w = BD.widthOf(txts[ti], fs, false);
        for (var row = 0; row < 4; row++) {
          var y = y0 + fs + 2 + row * fs * 1.3, ok = null;
          [x + 5, x - 5 - w].forEach(function (x0t) { if (ok) return; var b = { x0: x0t - 2, x1: x0t + w + 2, y0: y - fs, y1: y + 3 }; if (free(b)) ok = { x: x0t, b: b }; });
          if (ok) { o.push(t(ok.x, y, txts[ti], 'm')); labs.push(ok.b); named++; ti = txts.length; break; }
        }
      }
    });
    // the date axis: Mondays, every other one where they would crowd
    var mons = [], d0 = m.first;
    for (var d = d0; d <= m.end; d = addDay(d, 1)) if (new Date(d + 'T00:00:00Z').getUTCDay() === 1) mons.push(d);
    if (mons.length > 1 && X(mons[1]) - X(mons[0]) < fs * 4.5) mons = mons.filter(function (x, i) { return i % 2 === 0; });
    mons.forEach(function (x) { o.push(t(X(x), y1 + fs + 6, dd(x), 'm', 'middle')); obst.push(tw(X(x), y1 + fs + 6, dd(x), false, 'middle')); });
    // words on the data: the best line named at its right end; the low point named
    var now = m.now;
    if (now) {
      // named at its right end, clear of the line under the words: above the highest step it spans, else under the band
      var ex = Math.min(X(now.d), W - R - 4), tries = [['Best in town: ' + word(now.hi)], ['Best in town', word(now.hi)], ['Best now', word(now.hi)]], done = false;
      for (var ti = 0; ti < tries.length && !done; ti++) {
        var ls = tries[ti], bw = Math.max.apply(null, ls.map(function (z) { return BD.widthOf(z, fb, true); })), lh2 = fb * 1.2, hh = (ls.length - 1) * lh2;
        var span = m.days.filter(function (x) { return !x.gap && X(x.d) >= ex - bw - 4 && X(x.d) <= ex + 4; });
        var hiS = Math.max.apply(null, span.map(function (x) { return x.hi; }).concat(now.hi)), loS = Math.min.apply(null, span.map(function (x) { return x.lo; }).concat(now.lo));
        var cands = [Y(hiS) - 8 - hh, Y(loS) + fb + 6, Y(loS) + 2 * fb + 10].filter(function (y) { return y - fb >= y0 - 4 && y + hh <= y1 - 2; });
        for (var ci = 0; ci < cands.length; ci++) {
          var bb = { x0: ex - bw - 2, x1: ex + 2, y0: cands[ci] - fb, y1: cands[ci] + hh + 4 };
          if (free(bb)) { ls.forEach(function (z, j) { o.push(t(ex, cands[ci] + j * lh2, z, 'g b B', 'end')); }); labs.push(bb); done = true; break; }
        }
      }
      // no free place: the readout and the headline carry it
      var mn = m.days.filter(function (x) { return !x.gap; }).reduce(function (a, x) { return !a || x.hi < a.hi ? x : a; }, null);
      if (mn && mn.hi < now.hi - 2) {
        var txt = dd(mn.d) + ': ' + word(mn.hi), w = BD.widthOf(txt, fs, false), mx = Math.max(L + w / 2 + 2, Math.min(W - R - w / 2 - 4, X(mn.d))), my = Y(mn.hi) + fs + 8;
        var bx = { x0: mx - w / 2 - 2, x1: mx + w / 2 + 2, y0: my - fs, y1: my + 3 };
        if (free(bx)) { o.push(t(mx, my, txt, 'h', 'middle')); labs.push(bx); }   // under the low point, on a halo over the band
      }
    }
    // the state today, as a bracket at the right edge: its range and its middle bid
    if (stt) {
      var bx2 = W - R + 10, ya = Y(stt.hi), yb = Y(stt.lo), ymd = Y(stt.median);
      o.push('<path class="bm-br" d="M' + f1(bx2 + 6) + ' ' + f1(ya) + 'H' + f1(bx2) + 'V' + f1(yb) + 'H' + f1(bx2 + 6) + 'M' + f1(bx2 - 4) + ' ' + f1(ymd) + 'H' + f1(bx2 + 10) + '"/>');
      var gx = bx2 + 14;
      if (phone) { o.push(t(gx, ymd - 4, stt.short, 'b')); o.push(t(gx, ymd + fs + 2, word(stt.median), 'b')); }
      else {
        [[stt.name + ' today', 'b B'], ['middle ' + word(stt.median), 'b'], [word(stt.lo) + ' to ' + word(stt.hi), 'm'], [stt.n + ' bids, vs ' + stt.label, 'm']].forEach(function (z, i) { o.push(t(gx, ymd - fs * 1.4 + i * fs * 1.3, z[0], z[1])); });
      }
    }
    var dp = function (cls, a) { return a.length ? '<path class="' + cls + '" d="' + a.join('') + '"/>' : ''; };
    var aria = m.head;
    var s = '<svg class="bd-svg bm-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(aria) + '" style="font-size:' + fs + 'px' + (card ? ';font-family:Inter, system-ui, sans-serif' : '') + '">' +
      (card ? BD.cardStyle(BD.CARD) + '<style>.bm-band{fill:rgba(233,237,235,.16)}.bm-top{fill:none;stroke:' + BD.CARD.gold + ';stroke-width:2.5}.bm-own{fill:none;stroke:' + BD.CARD.ink + ';stroke-width:1.4}.h{paint-order:stroke;stroke:' + BD.CARD.bg + ';stroke-width:3px}.bm-br{fill:none;stroke:' + BD.CARD.ink + ';stroke-width:1.4}.bm-mk{fill:none;stroke:' + BD.CARD.mid + ';stroke-width:1;stroke-dasharray:2 3}</style>' : '') +
      dp('gr', P.gr) + dp('ev', P.ev) + '<path class="bm-band" d="' + band + '"/>' + mk + own + '<path class="bm-top" d="' + topLine + '"/>' +
      '<line class="bm-hair" x1="0" x2="0" y1="' + y0 + '" y2="' + y1 + '" visibility="hidden"/>' + o.join('') + '</svg>';
    return { svg: s, labs: labs, obst: obst, plot: PB, named: named, X: X, L: L, R: R, W: W, y0: y0, y1: y1, day: function (px) { var f = (px - L) / Math.max(1, W - L - R - 8); var d = new Date(t0 + Math.round(f * (t1 - t0) / 864e5) * 864e5).toISOString().slice(0, 10); return d < m.first ? m.first : d > m.end ? m.end : d; } };
  }

  function readout(m, d, held, show) {
    var x = m.days.filter(function (z) { return z.d === d; })[0];
    if (!x || x.gap) return [dd(d) + ':', 'nothing logged for an open month.'];
    var who = x.top, extra = m.lines.filter(function (l) { return show[l.key]; }).map(function (l) { var p = held(l, d); return l.name + ' ' + (p ? word(p.v) : 'none'); });
    return [dd(d) + ':', 'best ' + word(x.hi) + ' (' + (who.length > 2 ? who.length + ' elevators' : who.join(' and ')) + '), lowest ' + word(x.lo) + ', ' + x.n + (x.n === 1 ? ' elevator' : ' elevators') + ' posting.' + (extra.length ? ' ' + extra.join('; ') + '.' : '')];
  }

  function mount(el, o) {
    var H = root.CbBasisHist, det = el.querySelector('details[data-basis-hist]');
    if (!H || !det) return { crop: function () {}, save: function () {} };
    var boards = [], relay = []; try { boards = JSON.parse(det.getAttribute('data-boards') || '[]'); relay = JSON.parse(det.getAttribute('data-relay') || '[]'); } catch (e) {}
    boards = boards.filter(function (b, i) { return relay.indexOf(i) < 0; });   // a relayed board is drawn once, by the elevator
    var st = String(det.getAttribute('data-basis-hist') || '').toUpperCase(), town = det.getAttribute('data-town') || o.cfg.town;
    det.hidden = true; el.classList.add('bm-on');
    var wrap = root.document.createElement('div'); wrap.className = 'bm';
    wrap.innerHTML = '<p class="bd-axis bm-axis"></p><div class="bd-plot bm-plot" tabindex="0" role="group" aria-label="Arrow keys step through the days"></div>' +
      '<p class="bd-read bm-read" aria-live="polite"></p><details class="bm-more"><summary></summary><div class="bm-boards" role="group" aria-label="Draw one elevator&rsquo;s line"></div></details><p class="bd-note bm-note"></p>';
    el.appendChild(wrap);
    var q = function (s) { return wrap.querySelector(s); }, plot = q('.bm-plot'), read = q('.bm-read'), list = q('.bm-boards'), noteEl = q('.bm-note');
    var data = null, cur = o.crop, m = null, pic = null, show = {}, sel = '', lastW = 0, c = null;
    var load = root.fetch('/data/basis-sparklines/' + st + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var stateOf = function () {
      var s = (((o.bs || {}).states || {})[st] || {}), h = (s.crops || {})[cur];
      return h && h.median != null ? { median: BD.cents(h.median), lo: BD.cents(h.lo), hi: BD.cents(h.hi), n: h.n, label: h.label, name: s.name || st, short: (s.name || st) } : null;
    };
    var say = function (d) { var r = readout(m, d, H.heldOn, show); read.innerHTML = '<b>' + esc(r[0]) + '</b> ' + esc(BD.hy(r[1])); };
    var draw = function (force) {
      var W = Math.round(plot.clientWidth); if (!W || !m || m.short || (W === lastW && !force)) return; lastW = W;
      pic = svg(m, W, plot.clientHeight || 400, { show: show, held: H.heldOn, state: stateOf() });
      plot.innerHTML = pic.svg; say(sel || m.end);
    };
    var build = function () {
      var all = H.crops(data, boards, town, 99, st);
      c = all.filter(function (x) { return x.crop === cur; })[0];
      if (!c) { plot.innerHTML = ''; read.textContent = 'No ' + ADJ[cur] + ' basis logged in ' + town + ' yet.'; o.head.textContent = 'No ' + ADJ[cur] + ' basis logged in ' + town + ' yet'; o.take.textContent = ''; return; }
      m = model(c, H.heldOn, town, data.publicFrom, o.today ? o.today(cur, ctDay(data.generated)) : null);
      o.head.textContent = BD.hy(m.head); o.take.textContent = BD.hy(m.take);
      // a log of fewer than three days: the one sentence, no chart
      [plot, list.parentNode, q('.bm-axis'), read].forEach(function (e) { e.hidden = !!m.short; });
      if (m.short) { plot.innerHTML = ''; pic = null; read.textContent = ''; noteEl.textContent = 'Source: posted elevator bids, logged by AGSIST.'; return; }
      q('.bm-axis').textContent = (cur === 'soybeans' ? 'Soybean' : ADJ[cur].replace(/^./, function (x) { return x.toUpperCase(); })) + ' basis in ' + town + ', cents a bushel over or under futures, since ' + dd(m.first);
      q('.bm-more summary').textContent = 'Draw one elevator’s own line (' + m.lines.length + ' since ' + dd(m.first) + ')';
      list.innerHTML = m.lines.map(function (l) { return '<button type="button" data-k="' + esc(l.key) + '" aria-pressed="' + (!!show[l.key]) + '">' + esc(BD.hy(l.name)) + '</button>'; }).join('');
      [].slice.call(list.querySelectorAll('button')).forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-k'); show[k] = !show[k]; b.setAttribute('aria-pressed', String(!!show[k])); draw(true); }); });
      var stt = stateOf();
      noteEl.textContent = BD.hy('Each elevator’s basis for its nearest open delivery month, logged on the days it changed; it holds flat between changes. When a month closes the next one takes over, so a step there is partly a new month. ' +
        ((m.marks || []).length ? 'Dotted lines: ' + m.marks.map(function (k) { return k.text; }).join('; ') + '. ' : '') +
        ((m.off || []).length ? 'Not in the band from ' + dd(m.start) + ', on another futures month: ' + m.off.map(function (z) { return z.name + ' (' + conWord(z.con) + ')'; }).join('; ') + '. ' : '') +
        (m.strays.length ? 'Kept out of the band, far from the others: ' + m.strays.join('; ') + '. ' : '') +
        (stt ? 'Bracket: ' + stt.name + ' today, ' + stt.n + ' bids against ' + stt.label + ' futures, middle ' + word(stt.median) + '. ' : '') +
        'Source: posted elevator bids, logged by AGSIST since ' + dd(m.first) + ', ' + m.first.slice(0, 4) + '.');
      draw(true);
    };
    var move = function (ev) { if (!pic) return; var rc = plot.getBoundingClientRect(), px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rc.left) * pic.W / rc.width; sel = pic.day(px); hair(); say(sel); };
    var hair = function () { var h = plot.querySelector('.bm-hair'); if (!h || !sel) return; var x = f1(pic.X(sel)); h.setAttribute('x1', x); h.setAttribute('x2', x); h.setAttribute('visibility', 'visible'); };
    plot.addEventListener('mousemove', move); plot.addEventListener('touchstart', move, { passive: true }); plot.addEventListener('touchmove', move, { passive: true });
    plot.addEventListener('keydown', function (ev) {
      if (!m) return; var d = sel || m.end, k = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0; if (!k) return;
      ev.preventDefault(); d = addDay(d, k); if (d < m.first) d = m.first; if (d > m.end) d = m.end; sel = d; hair(); say(d);
    });
    if (root.ResizeObserver) new root.ResizeObserver(function () { draw(); }).observe(plot);
    var api = {
      crop: function (cr) { cur = cr; show = {}; sel = ''; load.then(function (d) { data = d; if (!d || !d.series) { read.textContent = 'The basis log could not be loaded. Try again later.'; return; } build(); }); },
      save: function (url) {
        if (!m) return;
        var stt = stateOf(), cfg = Object.assign({}, o.cfg, { url: url });
        BD.frame({ head: m.head, take: m.cardTake, kicker: town + ', ' + st + ' · ' + ADJ[cur] + ' basis since ' + dd(m.first), source: 'The band: lowest to highest bid in town each day; gold, the best. Posted elevator bids, logged by AGSIST.' },
          cfg, function (w, h) { return svg(m, w, h, { card: true, fs: 16, held: H.heldOn, show: show, state: stt }).svg; }, function (b) {
            if (!b) return; var a = root.document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'agsist-basis-month-' + String(o.cfg.path || 'town').split('/').pop() + '-' + cur + '.png';
            root.document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          });
      }
    };
    return api;
  }

  var api = { model: model, svg: svg, readout: readout, mount: mount, ctDay: ctDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BasisMonth = api;
})(typeof window !== 'undefined' ? window : globalThis);
