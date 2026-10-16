/* components/hay-ams.js -- /hay-prices: this week's hay trades from the USDA
 * AMS state hay reports (data/hay/ams-hay.json, scripts/fetch_hay_ams.py),
 * by grade and bale type, next to the NASS monthly price received
 * (data/hay/hay-prices.json) for the same state.
 *
 * The two are never blended. AMS = confirmed trades this week for the grades
 * the reporter saw, $ a ton, each report with its own date. NASS = last
 * month's average price received for all hay sold in the state. Each is
 * labeled for what it is wherever it shows.
 *
 * A report with no rows, or no file at all, shows the designed empty state
 * ("Trades load after the first USDA read"); a missing average stays blank.
 *
 * Pure parts (GRADES, gradeRank, summary, view, nassFor, ageDays) run in node
 * for test/hay-ams.test.mjs; mount() draws the section.
 */
(function (root) {
  'use strict';

  /* AMS hay quality designations, best first (AMS Hay Quality Guidelines).
     Combined grades ("Good/Premium") sit between their two parts. */
  var GRADES = ['supreme', 'premium/supreme', 'premium', 'good/premium', 'good', 'fair/good', 'fair', 'utility/fair', 'utility'];
  function gradeRank(g) {
    var i = GRADES.indexOf(String(g || '').toLowerCase().replace(/\s+/g, ''));
    return i < 0 ? GRADES.length : i;
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function day(iso, year) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return '';
    return MON[+p[1] - 1] + ' ' + (+p[2]) + (year === false ? '' : ', ' + p[0]);
  }
  function ageDays(iso, now) {
    var t = Date.parse(String(iso || '') + 'T12:00:00Z');
    return isFinite(t) ? Math.floor((now - t) / 864e5) : null;
  }
  function good(x) { return typeof x === 'number' && isFinite(x) && x > 0; }
  function money(v) { return good(v) ? '$' + Math.round(v).toLocaleString('en-US') : ''; }
  function isAlfalfa(c) { return /alfalfa/i.test(c || ''); }

  /* Low and high $ a ton across rows, and the tons behind them. */
  function span(rows) {
    if (!rows.length) return null;
    var lo = Infinity, hi = -Infinity, t = 0;
    rows.forEach(function (r) { lo = Math.min(lo, r.lo); hi = Math.max(hi, r.hi); t += r.qty; });
    return { lo: lo, hi: hi, tons: t };
  }

  /* One line per report for the all-states list: alfalfa and other hay
     ranges (hay rows only; straw is its own thing). */
  function summary(rep) {
    var hay = (rep.rows || []).filter(function (r) { return r.kind === 'hay'; });
    return {
      alfalfa: span(hay.filter(function (r) { return isAlfalfa(r.commodity); })),
      other: span(hay.filter(function (r) { return !isAlfalfa(r.commodity); })),
      straw: span((rep.rows || []).filter(function (r) { return r.kind === 'straw'; }))
    };
  }

  /* data/hay/ams-hay.json -> what the section draws. now = ms. A report is
     "old" after 21 days (35 when AMS says it is bi-weekly): still shown,
     with its date and a flag, never passed off as this week. */
  function view(doc, now) {
    var reps = ((doc && doc.reports) || []).filter(function (r) { return r && r.rows && r.rows.length && /^\d{4}-\d{2}-\d{2}$/.test(r.date || ''); });
    if (!reps.length) return null;
    return reps.map(function (r) {
      var a = ageDays(r.date, now), lim = r.biweekly ? 35 : 21;
      var groups = [], byKey = {};
      r.rows.slice().sort(function (x, y) {
        return (x.kind === y.kind ? 0 : x.kind === 'hay' ? -1 : 1) ||
          (isAlfalfa(y.commodity) - isAlfalfa(x.commodity)) ||
          (x.commodity < y.commodity ? -1 : x.commodity > y.commodity ? 1 : 0) ||
          (gradeRank(x.grade) - gradeRank(y.grade)) || (y.qty - x.qty);
      }).forEach(function (row) {
        var k = row.kind + '|' + row.commodity + (row.organic ? '|organic' : '');
        if (!byKey[k]) { byKey[k] = { kind: row.kind, commodity: row.commodity, organic: !!row.organic, rows: [] }; groups.push(byKey[k]); }
        byKey[k].rows.push(row);
      });
      return {
        id: r.id, state: r.state, name: r.state_name || r.state, title: r.title, kind: r.kind || 'direct',
        date: r.date, week: r.week_ending || null, age: a, old: a != null && a > lim, biweekly: !!r.biweekly,
        tons: r.tons || {}, lastReported: r.last_reported || null, comment: r.comment || '',
        url: r.source_url || null, pdf: r.pdf_url || null, groups: groups, sum: summary(r),
        perBale: r.per_bale_tables || 0, ok: !r.status || r.status.ok !== false
      };
    }).sort(function (x, y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : (x.date < y.date ? 1 : -1); });
  }

  /* NASS's newest month for the state from data/hay/hay-prices.json, labeled
     as the monthly average price received. key 'alfalfa' | 'other'. */
  function nassFor(nass, st, key) {
    if (!nass || !nass.series || !nass.months || !nass.latest) return null;
    var s = nass.series[key], i = nass.months.indexOf(nass.latest);
    if (!s || i < 0) return null;
    var v = s.states && s.states[st] ? s.states[st][i] : null;
    var m = nass.latest.split('-');
    return { v: good(v) ? v : null, flag: good(v) ? null : v, month: MONTH[+m[1] - 1] + ' ' + m[0],
      released: nass.released ? day(nass.released) : '' };
  }

  var api = { GRADES: GRADES, gradeRank: gradeRank, span: span, summary: summary, view: view, nassFor: nassFor, ageDays: ageDays, day: day, money: money };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.HayAms = api;

  /* ---------- browser ---------- */
  var d = root.document;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rng(s) { return !s ? '' : s.lo === s.hi ? money(s.lo) : money(s.lo) + ' to ' + money(s.hi); }
  function tons(x) { return (Math.round(x * 100) / 100).toLocaleString('en-US'); }
  var KEY = 'agsist-hay-ams';

  function mount() {
    var box = d.getElementById('hp-ams-live'); if (!box || !root.fetch) return;
    var V = null, NASS = null, PICK = '';
    try { var sv = JSON.parse(localStorage.getItem(KEY) || 'null'); if (sv && /^[A-Z]{2}$|^all$/.test(sv.st || '')) PICK = sv.st; } catch (e) {}
    if (!PICK) { try { var loc = JSON.parse(localStorage.getItem('agsist-wx-loc') || 'null'); if (loc && /^[A-Z]{2}$/.test(loc.state || '')) PICK = loc.state; } catch (e) {} }

    function nassLine(r) {
      var hasAlf = r.groups.some(function (g) { return g.kind === 'hay' && isAlfalfa(g.commodity); });
      var hasOther = r.groups.some(function (g) { return g.kind === 'hay' && !isAlfalfa(g.commodity); });
      var bits = [];
      [['alfalfa', 'alfalfa', hasAlf], ['other', 'other hay', hasOther]].forEach(function (k) {
        if (!k[2]) return;
        var n = nassFor(NASS, r.state, k[0]);
        if (!n) return;
        bits.push(k[1] + ' ' + (n.v ? '<b>' + money(n.v) + '</b> a ton' : 'not published'));
      });
      if (!bits.length) return '';
      var n0 = nassFor(NASS, r.state, 'alfalfa') || nassFor(NASS, r.state, 'other');
      return '<p class="hp-ams-nass"><span class="hp-ams-tag hp-ams-tag-n">NASS monthly</span> ' + esc(r.name) + ', ' + esc(n0.month) + ': ' + bits.join(', ') +
        '. That is the average price received for all hay sold in the state that month, every quality together (released ' + esc(n0.released) + '), not this week&rsquo;s trades.</p>';
    }

    function detail(r) {
      var h = '<div class="hp-ams-rep">';
      h += '<p class="hp-ams-k"><span class="hp-ams-tag">AMS this week</span> ' + esc(r.title) + '</p>';
      h += '<p class="hp-ams-when">' + (r.week ? 'Week ending ' + esc(day(r.week)) + ', reported ' : 'Reported ') + esc(day(r.date)) +
        (r.biweekly ? ' (every two weeks)' : '') + (r.old ? ' <span class="hp-ams-old">' + r.age + ' days old; no newer report yet</span>' : '') +
        (r.ok ? '' : ' <span class="hp-ams-old">the latest read failed a check; this is the last good report</span>') + '</p>';
      var t = r.tons.hay;
      if (t) h += '<p class="hp-fine">Confirmed hay trades: ' + tons(t.week) + ' tons this report' + (r.lastReported ? ', ' + tons(t.last) + ' last reported (' + esc(day(r.lastReported)) + ')' : '') + ', ' + tons(t.year) + ' a year ago.</p>';
      h += '<div class="hp-tw"><table class="hp-t hp-ams-t"><caption class="sr-only">' + esc(r.title) + ', $ a ton by grade and bale type</caption><thead><tr><th scope="col">Grade</th><th scope="col">Bale</th><th scope="col">Tons</th><th scope="col">$ a ton</th><th scope="col">Wtd avg</th></tr></thead><tbody>';
      r.groups.forEach(function (g) {
        h += '<tr class="hp-ams-g"><th colspan="5" scope="colgroup">' + esc(g.commodity) + (g.kind === 'straw' ? ' straw' : '') + (g.organic ? ', organic' : '') + '</th></tr>';
        g.rows.forEach(function (row) {
          h += '<tr><th scope="row">' + esc(row.grade || 'not graded') + '</th><td class="tl">' + esc(row.bale) + (row.freight && row.freight !== 'F.O.B.' ? ' <span class="hp-flag">' + esc(row.freight) + '</span>' : '') +
            (row.desc ? ' <span class="hp-flag">' + esc(row.desc) + '</span>' : '') + '</td><td>' + tons(row.qty) + '</td><td>' +
            (row.lo === row.hi ? money(row.lo) : money(row.lo) + '&ndash;' + money(row.hi)) + '</td><td>' + (row.avg != null ? money(row.avg) : '<span class="hp-flag">none given</span>') + '</td></tr>';
        });
      });
      h += '</tbody></table></div>';
      h += nassLine(r);
      if (r.comment) h += '<p class="hp-fine"><b>AMS market note:</b> ' + esc(r.comment) + '</p>';
      if (r.perBale) h += '<p class="hp-fine">' + r.perBale + ' table' + (r.perBale > 1 ? 's' : '') + ' priced by the bale ' + (r.perBale > 1 ? 'are' : 'is') + ' left out here; this page shows tons only.</p>';
      h += '<p class="hp-fine">F.O.B. means at the seller&rsquo;s farm, before trucking. Grades are AMS&rsquo;s (<a href="https://www.ams.usda.gov/sites/default/files/media/HayQualityGuidelines.pdf">Hay Quality Guidelines</a>). Source: ' +
        (r.url ? '<a href="' + esc(r.url) + '">USDA AMS, ' + esc(r.title) + '</a>' : 'USDA AMS') + '.</p>';
      return h + '</div>';
    }

    function list() {
      var h = '<div class="hp-tw"><table class="hp-t hp-ams-t"><caption class="sr-only">Latest AMS hay report by state, $ a ton</caption><thead><tr><th scope="col">State</th><th scope="col">Reported</th><th scope="col">Alfalfa</th><th scope="col">Other hay</th></tr></thead><tbody>';
      V.forEach(function (r) {
        h += '<tr><th scope="row"><button type="button" class="hp-st" data-ams="' + esc(r.state) + '">' + esc(r.name) + '</button>' + (r.kind === 'auction' ? ' <span class="hp-flag">auction</span>' : '') + '</th><td>' + esc(day(r.date, false)) +
          (r.old ? ' <span class="hp-ams-old">old</span>' : '') + '</td><td>' + (rng(r.sum.alfalfa) || '<span class="hp-flag">none</span>') + '</td><td>' + (rng(r.sum.other) || '<span class="hp-flag">none</span>') + '</td></tr>';
      });
      return h + '</tbody></table></div><p class="hp-fine">Ranges run from the lowest grade traded to the highest. Pick a state for each grade and bale type.</p>';
    }

    function render() {
      if (!V) return;
      var states = V.map(function (r) { return r.state; });
      var st = states.indexOf(PICK) >= 0 ? PICK : 'all';
      var opts = '<option value="all"' + (st === 'all' ? ' selected' : '') + '>All states with a report</option>' + V.map(function (r) {
        return '<option value="' + esc(r.state) + '"' + (r.state === st ? ' selected' : '') + '>' + esc(r.name) + '</option>';
      }).join('');
      var h = '<p class="hp-fine"><span class="hp-ams-tag">AMS this week</span> Confirmed trades USDA AMS market reporters saw in each state, in dollars a ton, by quality grade and bale type. Each state reports on its own day, so every report carries its date. A few good loads can set the price, and not every state has a report.</p>' +
        '<p class="hp-ams-pick"><label>State <select id="hp-ams-st">' + opts + '</select></label></p>';
      if (st === 'all') h += list();
      else V.filter(function (r) { return r.state === st; }).forEach(function (r) { h += detail(r); });
      if (st !== 'all' && PICK && states.indexOf(PICK) < 0) h += '<p class="hp-fine">AMS has no hay report for your state on file.</p>';
      box.innerHTML = h;
      var sel = d.getElementById('hp-ams-st');
      sel.addEventListener('change', function () { PICK = sel.value; try { localStorage.setItem(KEY, JSON.stringify({ st: PICK })); } catch (e) {} render(); var s2 = d.getElementById('hp-ams-st'); if (s2) s2.focus(); });
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-ams]'); if (!b) return;
      PICK = b.getAttribute('data-ams'); try { localStorage.setItem(KEY, JSON.stringify({ st: PICK })); } catch (e2) {} render();
      var s = d.getElementById('hp-ams-st'); if (s) s.focus();
    });
    var get = function (u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    Promise.all([get('/data/hay/ams-hay.json'), get('/data/hay/hay-prices.json')]).then(function (a) {
      NASS = a[1];
      V = view(a[0], Date.now());
      if (V) render();
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', mount); else mount();
})(typeof window !== 'undefined' ? window : this);
