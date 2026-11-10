/* components/cb-basis-hist.js -- "Basis since Oct 11, 2026" on a cash-bids town page.
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
 *   The log's public record starts on its publicFrom day (2026-10-11), and
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
      sc.src = '/components/elev-names.js?v=2';
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

  /* ONE SCALE PER TOWN AND CROP (Nov 4, 2026, site panel). Each elevator's chart used to take its own
     low, high and start date, so a 15-cent swing filled the same height as a 30-cent one and two lines
     side by side could not be compared. scaleFor() takes every elevator's points for one crop in the town:
     the low and high rounded out to 5 cents, the first logged date to the log's last run. The axis values
     print beside each chart (HTML, since the chart stretches to the page). */
  function scaleFor(sets, endDate) {
    var lo = Infinity, hi = -Infinity, d0 = '', d1 = endDate || '';
    sets.forEach(function (pts) {
      pts.forEach(function (p) {
        if (!d0 || p.date < d0) d0 = p.date;
        if (p.date > d1) d1 = p.date;
        if (p.gap) return;
        if (p.cents < lo) lo = p.cents;
        if (p.cents > hi) hi = p.cents;
      });
    });
    if (!isFinite(lo)) return null;
    lo = Math.floor(lo / 5) * 5; hi = Math.ceil(hi / 5) * 5;
    if (lo === hi) { lo -= 5; hi += 5; }
    return { lo: lo, hi: hi, d0: d0, d1: d1 };
  }
  var CH_H = 84, CH_PT = 8, CH_PB = 8;
  function axis(sc) {
    var Yp = function (c) { return ((CH_PT + (sc.hi - c) * (CH_H - CH_PT - CH_PB) / (sc.hi - sc.lo)) / CH_H * 100).toFixed(1); };
    var ys = [sc.hi, sc.lo];
    if (sc.lo < 0 && sc.hi > 0 && Math.min(sc.hi, -sc.lo) >= (sc.hi - sc.lo) * 0.2) ys.splice(1, 0, 0);
    return '<div class="cbh-ya" aria-hidden="true">' + ys.map(function (c) { return '<span style="top:' + Yp(c) + '%">' + basisText(c) + '</span>'; }).join('') + '</div>';
  }
  function chart(pts, endDate, label, sc) {
    var w = 320, h = CH_H, pl = 4, pr = 4, pt = CH_PT, pb = CH_PB;
    var lo = sc.lo, hi = sc.hi, vals = pts.filter(function (p) { return !p.gap; });
    var lastD = pts[pts.length - 1].date;
    var t0 = Date.parse(sc.d0), t1 = Date.parse(sc.d1 > lastD ? sc.d1 : lastD);
    if (!(t1 > t0)) t1 = t0 + 864e5;
    var X = function (d) { return (pl + (Date.parse(d) - t0) * (w - pl - pr) / (t1 - t0)).toFixed(1); };
    var Y = function (c) { return (pt + (hi - c) * (h - pt - pb) / (hi - lo)).toFixed(1); };
    var s = '', segs = [], cur = null, prev = null;
    pts.forEach(function (p) {
      if (p.gap) { if (cur) { cur.push(X(p.date) + ',' + Y(prev.cents)); segs.push(cur); cur = null; } prev = null; return; }
      if (cur && prev) {
        cur.push(X(p.date) + ',' + Y(prev.cents));
        if (p.con !== prev.con || p.dm !== prev.dm)
          s += '<line x1="' + X(p.date) + '" y1="' + pt + '" x2="' + X(p.date) + '" y2="' + (h - pb) + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,3" vector-effect="non-scaling-stroke"/>';
      } else cur = [];
      cur.push(X(p.date) + ',' + Y(p.cents));
      prev = p;
    });
    if (cur) { if (endDate > lastD) cur.push(X(endDate) + ',' + Y(prev.cents)); segs.push(cur); }
    if (lo <= 0 && hi >= 0) s += '<line x1="0" y1="' + Y(0) + '" x2="' + w + '" y2="' + Y(0) + '" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    segs.forEach(function (sg) { s += '<polyline points="' + sg.join(' ') + '" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'; });
    /* a dot per logged change: a zero-length round-capped line stays round when the chart is stretched to the page's width */
    vals.forEach(function (p) { s += '<line x1="' + X(p.date) + '" y1="' + Y(p.cents) + '" x2="' + X(p.date) + '" y2="' + Y(p.cents) + '" stroke="var(--gold)" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'; });
    return '<div class="cbh-ch">' + axis(sc) + '<svg class="cbh-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">' + s + '</svg>' +
      '<div class="cbh-xa" aria-hidden="true"><span>' + dayText(sc.d0) + '</span><span>' + dayText(sc.d1 > lastD ? sc.d1 : lastD) + '</span></div></div>';
  }

  function cropBlock(name, cropLabel, pts, endDate, sc) {
    var vals = pts.filter(function (p) { return !p.gap; });
    var first = vals[0], last = vals[vals.length - 1], tail = pts[pts.length - 1];
    var cents = vals.map(function (p) { return p.cents; });
    var head = '<h3 class="cbh-h">' + esc(name) + ': ' + esc(cropLabel.toLowerCase()) + '</h3>';
    var now = tail.gap ? 'Last logged ' + basisText(last.cents) + ' for ' + monText(last.dm) + ' delivery' + (last.con ? ' vs ' + esc(last.con) : '') +
      ' on ' + dayText(last.date) + '; nothing logged for ' + monText(tail.dm) + ' or later since ' + dayText(tail.date) + '. ' :
      basisText(last.cents) + ' for ' + monText(last.dm) + ' delivery' + (last.con ? ' vs ' + esc(last.con) : '') + ' since ' + dayText(last.date) + '. ';
    var lead = '<p class="cbh-l">' + now + (vals.length > 1 ? 'From ' + basisText(first.cents) + ' on ' + dayText(first.date) +
      '; low ' + basisText(Math.min.apply(null, cents)) + ', high ' + basisText(Math.max.apply(null, cents)) + '.' : 'The only change logged.') + '</p>';
    var svg = vals.length > 1 ? chart(pts, endDate, cropLabel + ' basis at ' + name + ' from ' + dayText(first.date) + ' to ' + dayText(last.date) + ', ' + basisText(first.cents) + ' to ' + basisText(last.cents) + ', on a scale from ' + basisText(sc.lo) + ' to ' + basisText(sc.hi), sc || scaleFor([pts], endDate)) : '';
    var rows = pts.slice(-TABLE_MAX).reverse().map(function (p) {
      if (p.gap) return '<tr><td>' + dayText(p.date) + '</td><td>' + monText(p.dm) + '</td><td class="n cbh-mut">none</td><td><span class="cbh-mut">not logged</span></td></tr>';
      return '<tr><td>' + dayText(p.date) + '</td><td>' + monText(p.dm) + '</td><td class="n">' + basisText(p.cents) + '</td><td>' + (p.con ? esc(p.con) : '<span class="cbh-mut">not named</span>') + '</td></tr>';
    }).join('');
    var n = pts.length - TABLE_MAX;
    var more = n > 0 ? '<p class="cbh-mut">' + n + ' earlier ' + (n === 1 ? 'row is' : 'rows are') + ' in the line above.</p>' : '';
    return '<div class="cbh-crop">' + head + lead + svg +
      '<div class="cbh-scroll"><table class="cbh-t"><thead><tr><th>Changed</th><th>Delivery</th><th class="n">Basis</th><th>vs futures</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + more + '</div>';
  }

  function render(box, data) {
    var body = box.querySelector('.cbt-hist-body');
    var boards = [];
    try { boards = JSON.parse(box.getAttribute('data-boards') || '[]'); } catch (e) { boards = []; }
    if (!data || !data.series) { body.innerHTML = '<p class="cbt-sub">The basis log could not be loaded. Try again later.</p>'; return; }
    var end = String(data.generated || '').slice(0, 10), first = '';
    var from = /^\d{4}-\d{2}-\d{2}$/.test(String(data.publicFrom || '')) ? data.publicFrom : '';
    if (/^\d{4}/.test(end)) REF_YEAR = end.slice(0, 4);
    var html = '', none = [], got = {}, ser = {}, scales = {};
    boards.forEach(function (b, i) {
      CROPS.forEach(function (c) {
        var pts = nearestSeries(keysFor(data, b[0], b[1] || [], c[0]), end);
        if (!pts.length) return;
        got[i] = 1;
        (ser[c[0]] = ser[c[0]] || []).push(pts);
        if (!first || pts[0].date < first) first = pts[0].date;
      });
    });
    CROPS.forEach(function (c) { if (ser[c[0]]) scales[c[0]] = scaleFor(ser[c[0]], end); });
    boards.forEach(function (b, i) {
      if (!got[i]) { none.push(b[0]); return; }
      CROPS.forEach(function (c) {
        var pts = nearestSeries(keysFor(data, b[0], b[1] || [], c[0]), end);
        if (pts.length) html += cropBlock(b[0], c[1], pts, end, scales[c[0]]);
      });
    });
    var since = from ? fullDay(from) : (first ? dayText(first) : '');
    var intro = '<p class="cbt-sub">Basis for the nearest delivery month on each date' + (since ? ', since ' + since : '') +
      '. Only the days a basis changed are logged: it held flat between dots. A break in the line is a stretch when no open delivery month had a logged basis yet. A thin mark is where the delivery month or the futures contract changed, so the step there is partly a new reference, not only a new price. Every elevator\'s chart for a crop shares one scale and one time span, so the lines compare.</p>';
    if (none.length) html += '<p class="cbt-sub">No basis change logged' + (since ? ' since ' + since : '') + ' for ' + esc(none.join(', ')) + '.</p>';
    body.innerHTML = intro + html;
    /* the heading names where the public log starts, else the log's own first date (2026-10-17: the heading said
       June over a log from Aug 27) */
    var sum = box.querySelector('summary');
    if (sum && since) sum.textContent = 'Basis since ' + since;
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

  var css = '.cbh-crop{margin:12px 0 4px;padding-top:10px;border-top:1px solid var(--border)}' +
    '.cbh-h{margin:0 0 2px;font-size:.95rem}.cbh-l{margin:0 0 6px;font-size:.88rem;line-height:1.5;color:var(--text)}' +
    '.cbh-ch{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:6px;margin:4px 0 6px}' +
    '.cbh-ya{position:relative;height:84px;min-width:2.6em;font-family:\'JetBrains Mono\',monospace;font-size:.72rem;color:var(--text-muted)}' +
    '.cbh-ya span{position:absolute;right:0;transform:translateY(-50%);white-space:nowrap;line-height:1}' +
    '.cbh-svg{display:block;width:100%;height:84px}' +
    '.cbh-xa{grid-column:2;display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-muted);margin-top:2px}' +
    '.cbh-scroll{overflow-x:auto}.cbh-t{width:100%;border-collapse:collapse;font-size:.82rem}' +
    '.cbh-t th{text-align:left;color:var(--text-muted);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;padding:4px 6px;border-bottom:1px solid var(--border)}' +
    '.cbh-t td{padding:4px 6px;border-bottom:1px solid var(--border);color:var(--text);white-space:nowrap}' +
    '.cbh-t .n{text-align:right;font-family:\'JetBrains Mono\',monospace}.cbh-mut{color:var(--text-dim);font-size:.8rem}';

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
    module.exports = { normFac: normFac, normKey: normKey, parseDm: parseDm, contractOf: contractOf, nearestSeries: nearestSeries, keysFor: keysFor, basisText: basisText, scaleFor: scaleFor, chart: chart, render: render };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
