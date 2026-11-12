/* components/rent-chart.js: "median county rent by year" on each state rent page (/rent/<state>), on the shared
   chart kit (components/ag-chart.js). The page carries its numbers in <script type="application/json"
   id="rc-data"> (scripts/build_state_rent_pages.py chart_html) and the headline, takeaway and note for the
   opening range already printed, so nothing moves when this runs; this file only draws and keeps the words in
   step with the range picked.

   rc-data: { name, slug, noun ('cropland'), land ('non-irrigated cropland'), url, gen ('YYYY-MM-DD'),
              pts: [[year, median or null, counties or 'no survey' / 'not published']],
              chg: { 'base year': [percent, matched counties, their median then, their median now] } }
   What is plotted and what is said are the same thing: the headline is the plotted median in the first and the
   last year shown and the change between them. The takeaway gives the like-for-like figure (the counties
   published in both years, their median then and now) and says it is that; a range whose first year has none
   says so. Exports window.AgRentChart (and module.exports) for the tests. */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* the builder's money(): whole dollars plain, anything else with cents ($9.50 pasture) */
  function money(v) { return '$' + (v === Math.round(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  function whole(v) { return Math.floor(Math.abs(v) + 0.5); }
  /* ', up 55%' / ', down 3%' / ', about the same' for a change from a to b */
  function move(pct) { var w = whole(pct); return w === 0 ? 'about the same' : (pct > 0 ? 'up ' : 'down ') + w + '%'; }
  function ptOf(d, year) { return d.pts.filter(function (p) { return p[0] === year; })[0]; }
  function series(d) {
    return d.pts.filter(function (p) { return p[1] != null; }).map(function (p) { return { d: p[0] + '-01-01', v: p[1] }; });
  }
  function countOf(d, year) { var p = ptOf(d, year); return p && p[1] != null ? p[2] : null; }
  function dayText(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  function asOf(d) { var t = dayText(d.gen); return t ? ' Data as of ' + t + '.' : ''; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function firstLast(d) { var h = d.pts.filter(function (p) { return p[1] != null; }); return h.length ? [h[0][0], h[h.length - 1][0]] : [0, 0]; }
  /* the years between two held years that have no figure, split by why */
  function gapYears(d, y0, y1) {
    var ns = [], np = [];
    d.pts.forEach(function (p) { if (p[1] == null && p[0] > y0 && p[0] < y1) (p[2] === 'no survey' ? ns : np).push(p[0]); });
    return { ns: ns, np: np };
  }
  /* 'Dashed: no USDA survey (2015, 2018)' for the years shown; '' when nothing is dashed */
  function gapKey(d, y0, y1) {
    var g = gapYears(d, y0, y1), a = g.ns.length ? 'no USDA survey (' + g.ns.join(', ') + ')' : '', b = g.np.length ? 'too few counties published (' + g.np.join(', ') + ')' : '';
    return a || b ? 'Dashed: ' + (a && b ? a + ' or ' + b : a || b) : '';
  }
  /* the words under the chart: what is plotted, the dashes, the source */
  function note(d, from, to) {
    var y0 = +String(from).slice(0, 4), y1 = +String(to).slice(0, 4), k = gapKey(d, y0, y1);
    return 'Median of the counties USDA published each year, ' + d.land + ', dollars an acre. ' + (k ? k + '. ' : '') +
      'Source: USDA NASS Cash Rents Survey, county medians, ' + y0 + '–' + y1 + '.' + asOf(d);
  }
  /* the words for a range from its first year to its last */
  function story(d, from, to) {
    var y0 = +String(from).slice(0, 4), y1 = +String(to).slice(0, 4), p0 = ptOf(d, y0), p1 = ptOf(d, y1);
    if (!p1 || p1[1] == null || !p0 || p0[1] == null) return { head: '', take: '', summary: '', note: '' };
    var c = d.chg[String(y0)], head, take;
    if (y0 < y1) head = d.name + ' ' + d.noun + ' rent: ' + money(p0[1]) + ' an acre in ' + y0 + ', ' + money(p1[1]) + ' in ' + y1 + ', ' + move(100 * (p1[1] - p0[1]) / p0[1]);
    else head = d.name + ' ' + d.noun + ' rent: ' + money(p1[1]) + ' an acre in ' + y1;
    if (y0 === y1) take = 'The median of ' + p1[2] + ' counties.';
    else if (c) take = 'Like for like, the ' + c[1] + ' counties published in both years went from a median of ' + money(c[2]) + ' to ' + money(c[3]) + ', ' + move(c[0]) + '.';
    else take = 'Too few counties were published in both ' + y0 + ' and ' + y1 + ' to state a like-for-like change.';
    return { head: head, take: take, summary: head + '. ' + take, note: note(d, from, to) };
  }
  function tick(v, st) { return '$' + (st % 1 ? v.toFixed(2) : v.toLocaleString('en-US')); }
  function config(d, el) {
    var D = el.ownerDocument, fl = firstLast(d), yearOf = function (p) { return p.d.slice(0, 4); };
    var span = function (v) { return [+String(v.from).slice(0, 4), +String(v.to).slice(0, 4)]; };
    return {
      series: [{ key: 'r', name: d.name, points: series(d), color: 'var(--green,#5fc28a)', card: '#5fc28a', toggle: false,
                 endText: function (p) { return yearOf(p) + ': ' + money(p.v); }, startText: function (p) { return yearOf(p) + ': ' + money(p.v); } }],
      period: 'year', gapWord: 'survey', unit: cap(d.land) + ', $ an acre',
      fmt: money, tick: tick,
      gapLabel: function (g) {
        var y = +g.from.slice(0, 4), e = +g.to.slice(0, 4), why = {};
        for (; y <= e; y++) { var p = ptOf(d, y); why[p ? p[2] : 'x'] = 1; }
        return why['no survey'] && Object.keys(why).length === 1 ? 'no survey' : why['not published'] && Object.keys(why).length === 1 ? 'not published' : 'no figure';
      },
      gapKey: function (v) { var s = span(v); return gapKey(d, s[0], s[1]); },
      ranges: [{ label: '5 years', days: 5 * 366, aria: 'five years' }, { label: '10 years', days: 10 * 366, aria: 'ten years' }, { label: 'Since ' + fl[0], days: 0, aria: 'every survey year' }],
      range: 'Since ' + fl[0],
      story: function (v) { return story(d, v.from, v.to); },
      readout: function (v, day) {
        var y = +day.slice(0, 4), p = ptOf(d, y);
        return p && p[1] != null ? y + ': ' + money(p[1]) + ' an acre, median of ' + p[2] + ' counties' : y + ': ' + (p ? p[2] : 'no figure');
      },
      height: { phone: 200, wide: 260 },
      headEl: D.getElementById('rc-head'), takeEl: D.getElementById('rc-take'), noteEl: D.getElementById('rc-note'), tools: D.getElementById('rc-tools'),
      share: { url: d.url, title: d.name + ' cash rent by year', file: 'agsist-rent-' + d.slug + '.png', kicker: d.name + ' cash rent', dateText: fl[1] + ' survey',
               source: function (v) { var s = span(v); return 'Source: USDA NASS Cash Rents Survey, county medians, ' + s[0] + '–' + s[1] + '.' + asOf(d); } }
    };
  }
  function start() {
    var D = root.document, box = D && D.getElementById('rc-chart'), raw = D && D.getElementById('rc-data');
    if (!box || !raw || !root.AgChart) return;
    var d; try { d = JSON.parse(raw.textContent); } catch (e) { return; }
    root.AgChart.mount(box, config(d, box));
  }
  var api = { money: money, story: story, note: note, gapKey: gapKey, series: series, config: config, countOf: countOf, tick: tick };
  root.AgRentChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start); else start(); }
})(typeof window !== 'undefined' ? window : globalThis);
