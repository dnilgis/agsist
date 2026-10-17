/* components/fert-trend.js -- "How the middle price has moved" on /fertilizer.
 *
 * Loaded only when the reader opens the box: it fetches
 * data/fertilizer-coops-history.json (scripts/fetch_coop_fert.py appends a row
 * each time a co-op's cash price or its date changes) and replays it, day by
 * day, with the same rules the reader uses for the price cards
 * (fetch_coop_fert.summarize):
 *   * one price per co-op per product: the first one it listed;
 *   * only a dated price, 60 days old or less on that day, not flagged;
 *   * the middle from 2 co-ops up (two: their average), else no middle.
 * A point with fewer than 2 co-ops is withheld, and the table says so.
 * A point is drawn on each day the record changed and on each day a price
 * aged out; a run of days with the same co-ops and the same middle is one
 * point. When the co-ops behind a product change, the point says which.
 *
 * Tests: test/fert-trend.test.mjs (hand-worked replay, and a frozen copy of
 * the record checked against the reader's own summary for that day).
 */
(function (root) {
  'use strict';
  var STALE_DAYS = 60, MIN_CO = 2;
  var ORDER = ['anhydrous', 'urea', 'uan28', 'uan32', 'dap', 'map', 'potash', 'ams', '10-34-0', 'thiosul'];
  var NAMES = { anhydrous: 'Anhydrous ammonia', urea: 'Urea', uan28: 'UAN 28%', uan32: 'UAN 32%', dap: 'DAP', map: 'MAP',
    potash: 'Potash', ams: 'AMS', '10-34-0': '10-34-0', thiosul: 'Thio-Sul' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function dayNum(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000); }
  function isoOf(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function short(iso, yr) { var p = iso.split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]) + (yr ? ', ' + p[0] : ''); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  /* the reader's median: odd, the middle one; even, the average of the two, to the cent */
  function median(xs) {
    var a = xs.slice().sort(function (x, y) { return x - y; }), n = a.length;
    if (!n) return null;
    return n % 2 ? a[(n - 1) / 2] : Math.round((a[n / 2 - 1] + a[n / 2]) / 2 * 100) / 100;
  }

  function clean(hist) {
    return ((hist && hist.rows) || []).filter(function (r) {
      return Array.isArray(r) && r.length >= 7 && isDate(r[0]) && r[1] && r[3] != null;
    });
  }

  /* The state of every co-op price as of day D (rows seen on or before D). */
  function stateAt(rows, D) {
    var cur = {}, order = {}, i = 0;
    rows.forEach(function (r) {
      var k = r[1] + '\u0000' + r[3];
      if (!(k in order)) order[k] = i++;
      if (r[0] <= D) cur[k] = r;
    });
    return { cur: cur, order: order };
  }

  /* One product on day D: {n, mid, low, high, coops, oldest, newest}. */
  function pointAt(rows, key, D, st) {
    st = st || stateAt(rows, D);
    var best = {}, dn = dayNum(D);
    Object.keys(st.cur).forEach(function (k) {
      var r = st.cur[k];
      if (r[2] !== key || typeof r[4] !== 'number' || !(r[4] > 0) || !isDate(r[6]) || r[6] > D) return;
      if (r.length > 7 && r[7] === 'flagged') return;
      if (dn - dayNum(r[6]) > STALE_DAYS) return;
      var b = best[r[1]];
      if (!b || st.order[k] < b.o) best[r[1]] = { o: st.order[k], cash: r[4], date: r[6] };
    });
    var ids = Object.keys(best).sort(), vals = ids.map(function (c) { return best[c].cash; });
    var ds = ids.map(function (c) { return best[c].date; }).sort();
    return { date: D, n: ids.length, mid: ids.length >= MIN_CO ? median(vals) : null,
      low: vals.length ? Math.min.apply(null, vals) : null, high: vals.length ? Math.max.apply(null, vals) : null,
      coops: ids, oldest: ds[0] || null, newest: ds[ds.length - 1] || null };
  }

  /* Every product's points. asOf (ISO) caps the age-out days (default: the
     newest day in the record). */
  function series(hist, asOf) {
    var rows = clean(hist);
    if (!rows.length) return null;
    var seen = rows.map(function (r) { return r[0]; }).sort();
    var first = seen[0], last = isDate(asOf) && asOf > seen[seen.length - 1] ? asOf : seen[seen.length - 1];
    var days = {};
    seen.forEach(function (d) { days[d] = 1; });
    rows.forEach(function (r) {   // the day a price passes 60 days old
      if (isDate(r[6])) { var out = isoOf(dayNum(r[6]) + STALE_DAYS + 1); if (out > first && out <= last) days[out] = 1; }
    });
    var list = Object.keys(days).sort(), out = {};
    var states = list.map(function (D) { return stateAt(rows, D); });
    ORDER.forEach(function (key) {
      var pts = [];
      list.forEach(function (D, i) {
        var p = pointAt(rows, key, D, states[i]);
        var prev = pts[pts.length - 1];
        if (!prev && !p.n) return;
        if (prev && prev.n === p.n && prev.mid === p.mid && prev.coops.join() === p.coops.join()) return;
        if (prev) {
          p.added = p.coops.filter(function (c) { return prev.coops.indexOf(c) < 0; });
          p.dropped = prev.coops.filter(function (c) { return p.coops.indexOf(c) < 0; });
        }
        p.withheld = p.mid == null;
        pts.push(p);
      });
      if (pts.length) out[key] = pts;
    });
    return { first: first, last: last, products: out };
  }

  /* ---------------------------------------------------------- drawing */
  function chart(pts, name) {
    var shown = pts.filter(function (p) { return !p.withheld; });
    if (shown.length < 2) return '';
    var W = 320, H = 96, L = 8, R = 8, T = 12, B = 18;
    var x0 = dayNum(shown[0].date), x1 = dayNum(shown[shown.length - 1].date);
    var lo = Math.min.apply(null, shown.map(function (p) { return p.mid; }));
    var hi = Math.max.apply(null, shown.map(function (p) { return p.mid; }));
    if (hi - lo < 10) { var c = (hi + lo) / 2; lo = c - 5; hi = c + 5; }
    function X(d) { return x1 === x0 ? W / 2 : L + (dayNum(d) - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (hi - v) / (hi - lo) * (H - T - B); }
    var path = shown.map(function (p, i) { return (i ? 'L' : 'M') + X(p.date).toFixed(1) + ' ' + Y(p.mid).toFixed(1); }).join(' ');
    var marks = shown.map(function (p, i) {
      var changed = i > 0 && ((p.added && p.added.length) || (p.dropped && p.dropped.length));
      var tip = short(p.date, true) + ': ' + money(p.mid) + ', ' + (p.n === 2 ? 'average of 2 co-ops' : 'middle of ' + p.n + ' co-ops') + (changed ? ', co-ops changed' : '');
      return (changed ? '<line class="ft-set" x1="' + X(p.date).toFixed(1) + '" x2="' + X(p.date).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/>' : '') +
        '<g class="ft-pt"><circle class="ft-hit" cx="' + X(p.date).toFixed(1) + '" cy="' + Y(p.mid).toFixed(1) + '" r="12"/>' +
        '<circle class="ft-dot" cx="' + X(p.date).toFixed(1) + '" cy="' + Y(p.mid).toFixed(1) + '" r="4"/><title>' + esc(tip) + '</title></g>';
    }).join('');
    var a = shown[0], z = shown[shown.length - 1];
    return '<svg class="ft-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(name + ' middle price, ' + short(a.date, true) + ' ' + money(a.mid) + ' to ' + short(z.date, true) + ' ' + money(z.mid)) + '">' +
      '<line class="ft-base" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>' +
      '<path class="ft-line" d="' + path + '"/>' + marks +
      '<text class="ft-ax" x="' + L + '" y="' + (H - 4) + '">' + esc(short(a.date)) + '</text>' +
      '<text class="ft-ax" x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">' + esc(short(z.date)) + '</text></svg>';
  }

  function names(ids, coops) { return ids.map(function (c) { return esc((coops[c] && coops[c].name) || c); }).join(', '); }

  function table(pts, coops) {
    return '<table class="ft-t"><thead><tr><th scope="col">Day</th><th scope="col">Middle</th><th scope="col">Co-ops</th></tr></thead><tbody>' +
      pts.map(function (p) {
        var notes = [];
        if (p.added && p.added.length) notes.push('added ' + names(p.added, coops));
        if (p.dropped && p.dropped.length) notes.push('out: ' + names(p.dropped, coops));
        var mid = p.withheld ? '<span class="ft-wh">withheld</span>' : money(p.mid);
        var who = p.n + (p.n === 1 ? ' co-op' : ' co-ops') + (p.withheld && p.n ? ', too few for a middle' : '') + (!p.n ? ', none posting' : '');
        return '<tr><td>' + esc(short(p.date, true)) + '</td><td class="r">' + mid + '</td><td>' + who +
          (p.n && p.oldest ? '<span class="ft-sub">posted ' + esc(p.oldest === p.newest ? short(p.newest) : short(p.oldest) + ' to ' + short(p.newest)) + '</span>' : '') +
          (notes.length ? '<span class="ft-sub">' + notes.join('; ') + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function html(s, coopsDoc) {
    if (!s || !Object.keys(s.products).length) return '<p class="ft-note">No co-op price record yet.</p>';
    var coops = {};
    ((coopsDoc && coopsDoc.coops) || []).forEach(function (c) { coops[c.id] = c; });
    var blocks = ORDER.filter(function (k) { return s.products[k]; }).map(function (k) {
      var pts = s.products[k], shown = pts.filter(function (p) { return !p.withheld; });
      var head = '<h3 class="ft-h">' + esc(NAMES[k]) + '</h3>';
      if (!shown.length) {
        return '<div class="ft-p">' + head + '<p class="ft-note">Fewer than 2 co-ops have posted it on every day in the record, so no middle price is shown.</p>' + table(pts, coops) + '</div>';
      }
      var c = chart(pts, NAMES[k]);
      return '<div class="ft-p">' + head + (c || '<p class="ft-note">One point so far: the line starts when the middle price moves or the co-ops change.</p>') + table(pts, coops) + '</div>';
    }).join('');
    return '<p class="ft-note">The middle cash price on each day the co-ops&rsquo; posted prices changed, from AGSIST&rsquo;s own record of every co-op price read, ' +
      esc(short(s.first, true)) + ' to ' + esc(short(s.last, true)) + '. Same rules as the price cards: one price per co-op, dated, 60 days old or less. ' +
      'A day with fewer than 2 co-ops behind a product is withheld. A dotted line marks a day the co-ops behind the price changed, so a move there can be a different set of co-ops, not a price change.</p>' +
      '<div class="ft-grid">' + blocks + '</div>';
  }

  var CSS = '.fert-trend{margin:.25rem 0 1.25rem;border:1px solid var(--border);border-radius:10px;padding:.2rem .9rem}' +
    '.fert-trend>summary{cursor:pointer;color:var(--gold);font-weight:700;padding:.65rem 0;min-height:44px;box-sizing:border-box}' +
    '.ft-note{font-size:.8rem;color:var(--text-dim);line-height:1.5;margin:.25rem 0 .75rem}' +
    '.ft-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin-bottom:.75rem}' +
    '.ft-p{min-width:0}.ft-h{font-size:.9rem;margin:0 0 .35rem;color:var(--text)}' +
    '.ft-svg{display:block;width:100%;height:auto;max-height:120px;margin:0 0 .35rem}' +
    '.ft-line{fill:none;stroke:var(--gold);stroke-width:2;stroke-linejoin:round}' +
    '.ft-dot{fill:var(--gold);stroke:var(--bg-card,var(--bg,#fff));stroke-width:2}.ft-hit{fill:transparent}' +
    '.ft-base{stroke:var(--border);stroke-width:1}.ft-set{stroke:var(--text-muted);stroke-width:1;stroke-dasharray:2 3}' +
    '.ft-ax{fill:var(--text-muted);font-size:10px;font-family:inherit}' +
    '.ft-t{width:100%;border-collapse:collapse;font-size:.78rem}.ft-t th,.ft-t td{text-align:left;padding:.3rem .35rem;border-bottom:1px solid var(--border);vertical-align:top}' +
    '.ft-t th{color:var(--text-muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.04em}.ft-t td.r,.ft-t th:nth-child(2){text-align:right;white-space:nowrap}' +
    '.ft-sub{display:block;color:var(--text-muted);font-size:.72rem}.ft-wh{color:var(--text-muted);font-style:italic}';

  function boot() {
    var doc = root.document, el = doc && doc.getElementById('fert-trend');
    if (!el) return;
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    var body = el.querySelector('.ft-body'), done = false;
    el.addEventListener('toggle', function () {
      if (!el.open || done) return;
      done = true;
      body.innerHTML = '<p class="ft-note">Loading the price record&hellip;</p>';
      function j(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
      Promise.all([j('/data/fertilizer-coops-history.json'), j('/data/fertilizer-coops.json')]).then(function (r) {
        if (!r[0]) { body.innerHTML = '<p class="ft-note">The price record did not load. Close and open this again to retry.</p>'; done = false; return; }
        var asOf = r[1] && typeof r[1].generated === 'string' ? r[1].generated.slice(0, 10) : null;
        body.innerHTML = html(series(r[0], asOf), r[1]);
      });
    });
  }

  var api = { series: series, pointAt: pointAt, median: median, html: html, chart: chart, CSS: CSS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FertTrend = api; if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot); else boot(); } }
})(typeof window !== 'undefined' ? window : this);
