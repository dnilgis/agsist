/* components/rent-chart.js: "median county rent by year" on each state rent page (/rent/<state>), on the shared
   chart kit (components/ag-chart.js). The page carries its numbers in <script type="application/json"
   id="rc-data"> (scripts/build_state_rent_pages.py chart_html) and the headline and takeaway for the opening
   range already printed, so nothing moves when this runs; this file only draws and keeps the words in step
   with the range picked.

   rc-data: { name, noun ('cropland'), url, gen ('YYYY-MM-DD'),
              pts: [[year, median or null, counties or 'no survey' / 'not published']],
              chg: { 'base year': [percent, matched counties] } }
   A change is only ever the one the builder worked out on the same counties in both years (median then
   against median now), never two medians of different county sets; a range whose first year has none
   says the level alone. Exports window.AgRentChart (and module.exports) for the tests. */
(function (root) {
  'use strict';
  /* the builder's money(): whole dollars plain, anything else with cents ($9.50 pasture) */
  function money(v) { return '$' + (v === Math.round(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  function pct(v) { return (Math.round(Math.abs(v) * 10) / 10).toFixed(1) + '%'; }
  function series(d) {
    return d.pts.filter(function (p) { return p[1] != null; }).map(function (p) { return { d: p[0] + '-01-01', v: p[1] }; });
  }
  function countOf(d, year) { var p = d.pts.filter(function (q) { return q[0] === year; })[0]; return p && p[1] != null ? p[2] : null; }
  /* the words for a range from its first year to its last */
  function story(d, from, to) {
    var y0 = +String(from).slice(0, 4), y1 = +String(to).slice(0, 4), last = d.pts.filter(function (p) { return p[0] === y1; })[0];
    if (!last || last[1] == null) return { head: '', take: '', summary: '' };
    var c = d.chg[String(y0)], head;
    if (c && y0 < y1) {
      head = Math.abs(c[0]) < 0.05 ? d.name + ' ' + d.noun + ' rent is where it was in ' + y0
        : d.name + ' ' + d.noun + ' rent is ' + (c[0] > 0 ? 'up ' : 'down ') + pct(c[0]) + ' since ' + y0;
    } else head = d.name + ' ' + d.noun + ' rent: ' + money(last[1]) + ' an acre in ' + y1;
    var take = c && y0 < y1 ? money(last[1]) + ' an acre in ' + y1 + ', the median of ' + last[2] + ' counties. The change counts the ' + c[1] + ' counties published in both years.'
      : 'The median of ' + last[2] + ' counties.' + (y0 < y1 ? ' Too few were published in both ' + y0 + ' and ' + y1 + ' to state a change.' : '');
    return { head: head, take: take, summary: head + '. ' + take };
  }
  function config(d, el) {
    var D = el.ownerDocument;
    return {
      series: [{ key: 'r', name: d.name, points: series(d), color: 'var(--green,#5fc28a)', card: '#5fc28a', toggle: false }],
      period: 'year', gapWord: 'survey', unit: '$/acre',
      fmt: money, tick: function (v) { return '$' + (v % 1 ? v.toFixed(1) : v); },
      ranges: [{ label: '5Y', days: 5 * 366, aria: 'five years' }, { label: '10Y', days: 10 * 366, aria: 'ten years' }, { label: 'All', days: 0, aria: 'every survey year' }],
      range: 'All',
      story: function (v) { return story(d, v.from, v.to); },
      readout: function (v, day) {
        var y = +day.slice(0, 4), p = d.pts.filter(function (q) { return q[0] === y; })[0];
        return p && p[1] != null ? y + ': ' + money(p[1]) + ' an acre, median of ' + p[2] + ' counties' : y + ': ' + (p ? p[2] : 'no figure');
      },
      height: { phone: 200, wide: 260 },
      headEl: D.getElementById('rc-head'), takeEl: D.getElementById('rc-take'), tools: D.getElementById('rc-tools'),
      share: { url: d.url, title: d.name + ' cash rent by year', file: 'agsist-rent-' + d.slug + '.png', kicker: d.name + ' cash rent',
               source: 'Source: USDA NASS Cash Rents Survey, median of published counties', date: d.gen }
    };
  }
  function start() {
    var D = root.document, box = D && D.getElementById('rc-chart'), raw = D && D.getElementById('rc-data');
    if (!box || !raw || !root.AgChart) return;
    var d; try { d = JSON.parse(raw.textContent); } catch (e) { return; }
    root.AgChart.mount(box, config(d, box));
  }
  var api = { money: money, story: story, series: series, config: config, countOf: countOf };
  root.AgRentChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start); else start(); }
})(typeof window !== 'undefined' ? window : globalThis);
