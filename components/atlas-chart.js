/* components/atlas-chart.js: the Farmland Atlas county charts (cash rent, corn yield, crop insurance loss
   ratio, drought weeks, CRP acres) on the shared chart kit (components/ag-chart.js), Nov 12, 2026 (E51).
   Each <figure class="ach"> (scripts/build_atlas_pages.py kit_fig) carries its numbers in a
   <script type="application/json" class="ach-d">, the headline and takeaway for the opening range already
   printed, and the old labelled SVG in <noscript>. This file draws each one and keeps the words in step with
   the range picked. Every value's text is the page's own (printed by the builder), looked up here, never
   rounded again. story() is the twin of kit_story() in the builder.

   ach-d: { k: 'rent' | 'yield' | 'loss' | 'drought' | 'crp', lab: county label, unit,
            lines: [{ n: name, pts: [[year, value, text]] }], ref: [value, text, note] or null,
            chg: { 'base year': [sign, whole percent] } (rent), vs: [sign, percent] (yield against its median) }
   Exports window.AgAtlasChart (and module.exports) for the tests. */
(function (root) {
  'use strict';
  var PAL = [['var(--gold,#d4a23f)', '#e0ac45'], ['var(--blue,#4f94d8)', '#5ea4ea']];
  function inRange(c, y0, y1) { return c.lines[0].pts.filter(function (p) { return p[0] >= y0 && p[0] <= y1; }); }
  function story(c, y0, y1) {
    var pts = inRange(c, y0, y1);
    if (!pts.length) return { head: '', take: '', summary: '' };
    var last = pts[pts.length - 1], lab = c.lab, k = c.k, head, take;
    var top = pts.reduce(function (a, p) { return p[1] > a[1] || (p[1] === a[1] && p[0] > a[0]) ? p : a; });
    if (k === 'crp') {
      head = 'CRP acres in ' + lab + ': ' + last[2] + ' in ' + last[0];
      take = top[0] !== last[0] ? 'The most in the years shown: ' + top[2] + ' acres in ' + top[0] + '.' : 'The most enrolled in any year shown.';
    } else if (k === 'rent') {
      var ch = pts[0][0] < last[0] ? (c.chg || {})[String(pts[0][0])] : null, noun = c.lines[0].n + ' rent in ' + lab;
      if (ch && ch[0]) head = noun + ' is ' + (ch[0] > 0 ? 'up ' : 'down ') + ch[1] + '% since ' + pts[0][0];
      else if (ch) head = noun + ' is where it was in ' + pts[0][0];
      else head = noun + ': ' + last[2] + ' in ' + last[0];
      var more = c.lines.slice(1).filter(function (l) { return l.pts.length && l.pts[l.pts.length - 1][0] === last[0]; })
        .map(function (l) { return l.n.toLowerCase() + ' ' + l.pts[l.pts.length - 1][2]; });
      take = last[2] + ' an acre in ' + last[0] + (more.length ? ', ' + more.join(', ') : '') + ', nominal dollars.';
    } else if (k === 'yield') {
      head = lab + ' corn yield: ' + last[2] + ' bu in ' + last[0];
      var vs = c.vs;
      take = vs && vs[0] ? vs[1] + '% ' + (vs[0] > 0 ? 'above' : 'below') + ' the median of the published years (' + c.ref[1] + ' bu).'
        : c.ref ? 'At the median of the published years (' + c.ref[1] + ' bu).' : '';
      take += ' Best year shown: ' + top[2] + ' bu in ' + top[0] + '.';
    } else if (k === 'loss') {
      var hi = pts.filter(function (p) { return p[1] > 1; }).length;
      head = hi ? 'Claims topped premium in ' + hi + ' of ' + pts.length + ' crop years in ' + lab
        : 'Claims stayed under premium in all ' + pts.length + ' crop years shown in ' + lab;
      take = 'Loss ratio ' + last[2] + ' in ' + last[0] + '; the highest was ' + top[2] + ' in ' + top[0] + '.';
    } else {
      head = lab + ': ' + (last[1] === 0 ? 'no weeks' : last[1] === 1 ? '1 week' : last[2] + ' weeks') + ' of severe drought in ' + last[0];
      take = top[1] > 0 ? 'The most in the years shown: ' + top[2] + ' week' + (top[1] === 1 ? '' : 's') + ' in ' + top[0] + '.'
        : 'No week of severe drought in any year shown.';
    }
    return { head: head, take: take, summary: head + '. ' + take };
  }
  var TITLE = { rent: 'cash rent', yield: 'corn yield', loss: 'crop insurance loss ratio', drought: 'severe drought weeks', crp: 'CRP acres' };
  var SRC = { rent: 'USDA NASS county cash rent survey', yield: 'USDA NASS county yields', loss: 'USDA RMA summary of business',
    drought: 'U.S. Drought Monitor', crp: 'USDA FSA' };
  function config(c, els, url, gen) {
    var text = {}, slug = String(c.lab || 'county').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    c.lines.forEach(function (l) { l.pts.forEach(function (p) { text[p[1]] = p[2]; }); });
    if (c.ref) text[c.ref[0]] = c.ref[1];
    var all = c.lines[0].pts.map(function (p) { return p[0]; });
    var series = c.lines.map(function (l, i) {
      return { key: 'l' + i, name: l.n, points: l.pts.map(function (p) { return { d: p[0] + '-01-01', v: p[1] }; }), color: PAL[i % 2][0], card: PAL[i % 2][1] };
    });
    if (c.ref) series.push({ key: 'ref', name: c.ref[2], faint: true, note: c.ref[2], toggle: false,
      points: all.map(function (y) { return { d: y + '-01-01', v: c.ref[0] }; }) });
    var money = c.k === 'rent';
    return {
      series: series, period: 'year', unit: c.unit, minPoints: 3, floor: 0, gapWord: 'figure',
      fmt: function (v) { return text[v] != null ? text[v] : String(v); },
      // thousands as '15k' on the axis, so the widest tick fits the kit's left margin on a phone
      tick: function (v) { var t = Math.abs(v) >= 1000 ? String(+(v / 1000).toFixed(1)) + 'k' : String(+v.toFixed(2)); return money ? '$' + t : t; },
      ranges: [{ label: '10Y', days: 10 * 366, aria: 'ten years' }, { label: '20Y', days: 20 * 366, aria: 'twenty years' }, { label: 'All', days: 0, aria: 'every year held' }],
      range: 'All', height: { phone: 200, wide: 240 },
      story: function (v) { return story(c, +v.from.slice(0, 4), +v.to.slice(0, 4)); },
      headEl: els.head, takeEl: els.take, tools: els.tools,
      share: { url: url, title: c.lab + ' ' + TITLE[c.k], file: 'agsist-' + slug + '-' + c.k + '.png', kicker: c.lab + ', ' + TITLE[c.k],
               source: 'Source: ' + SRC[c.k] + '. AGSIST Farmland Atlas', date: gen || '' }
    };
  }
  function start() {
    var D = root.document, K = root.AgChart;
    if (!D || !K) return;
    var canon = D.querySelector('link[rel="canonical"]'), url = canon ? canon.href : String(root.location.href).split('#')[0];
    [].slice.call(D.querySelectorAll('figure.ach')).forEach(function (f) {
      var c; try { c = JSON.parse(f.querySelector('.ach-d').textContent); } catch (e) { return; }
      K.mount(f.querySelector('.ach-c'), config(c, { head: f.querySelector('.ach-h'), take: f.querySelector('.ach-t'), tools: f.querySelector('.ach-tools') }, url));
    });
  }
  var api = { story: story, config: config };
  root.AgAtlasChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start); else start(); }
})(typeof window !== 'undefined' ? window : globalThis);
