/* components/hog-cash.js: the cash hog block on /cattle-futures-prices (Nov 11, 2026).
   Reads data/hog-cash.json (USDA AMS: National Daily Direct Hog Prior Day Report, negotiated
   barrows and gilts, and the National Daily Pork Report, negotiated afternoon cutout).
   - Nothing shows until the file has a hog price; the section ships hidden and empty.
   - A hog report more than 5 trading days old hides the whole block (a weekday count from the
     report day to today in Central time; holidays count as trading days, so it hides early, never late).
   - The cutout has its own date and the same limit; an old cutout drops out alone.
   - The chart: a headline and a one-line takeaway computed from the range shown, the gap between the
     cutout and cash hogs shaded and labelled at both ends, each line named with its latest value at
     its right end (tap or press a name to hide or show that line), range buttons (2W, 1M, 3M, All)
     for the days the file holds, a faint line for cash hogs the same days a year earlier when the
     file holds them, a readout of any day on hover or tap, a draw-in on first view (none with
     reduced motion), and Share / Save the picture: a 1200 x 630 card that stands alone.
     Fewer than 5 report days held: no chart, the two figures show instead.
   The drawing, readout, ranges, toggles, card and buttons are the shared kit, components/ag-chart.js.
   Exports window.AgHogCash (and module.exports for the tests). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var STALE_TRADING_DAYS = 5, CHART_MIN = 5, FULL_DAYS = 30, HOLD_DAYS = 100;
  var RANGES = [['2W', 14, 'two weeks'], ['1M', 31, 'one month'], ['3M', 92, 'three months'], ['All', 0, 'all days held']];
  var PAGE = 'https://agsist.com/cattle-futures-prices';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function iso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null; }
  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }
  function pos(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  function money(v) { return '$' + v.toFixed(2); }
  function short(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return MON[+m[2] - 1] + ' ' + (+m[3]); }
  function long(s) { return short(s) + ', ' + s.slice(0, 4); }
  function today(nowMs) {
    var d = new Date(nowMs);
    try { return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).slice(0, 10); } catch (e) { return d.toISOString().slice(0, 10); }
  }
  /* weekdays after `from` up to and including `to` (both YYYY-MM-DD) */
  function tradingDays(from, to) {
    var a = utc(from), b = utc(to), n = 0;
    for (var t = a + 864e5; t <= b; t += 864e5) { var w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
    return n;
  }
  function stale(day, nowMs) { var t = today(nowMs); return day > t || tradingDays(day, t) > STALE_TRADING_DAYS; }

  function series(list, key, newest, days) {
    var cut = isoOf(utc(newest) - days * 864e5), seen = {};
    (Array.isArray(list) ? list : []).forEach(function (e) {
      if (e && iso(e.d) && e.d > cut && e.d <= newest && pos(e[key])) seen[e.d] = e[key];
    });
    return Object.keys(seen).sort().map(function (d) { return { d: d, v: seen[d] }; });
  }
  function withDay(pts, d, v) { return pts.filter(function (p) { return p.d !== d; }).concat([{ d: d, v: v }]).sort(function (a, b) { return a.d < b.d ? -1 : 1; }); }
  /* a year-ago day drawn on this year's axis; Feb 29 has no partner and is left out */
  function nextYear(d) { if (d.slice(5) === '02-29') return null; return (+d.slice(0, 4) + 1) + d.slice(4); }

  /* What the block shows, or null to keep it hidden. */
  function view(doc, nowMs) {
    var h = doc && doc.hogs, n = h && h.negotiated;
    if (!h || !n || !iso(h.report_date) || !pos(n.base)) return null;
    if (stale(h.report_date, nowMs)) return null;
    var hist = doc.history || {};
    var killed = (h.slaughter_dates || []).filter(iso).sort();
    var out = {
      hogs: { val: money(n.base), date: h.report_date,
        meta: (killed.length ? 'Hogs killed ' + killed.map(short).join(' and ') + ', reported ' + long(h.report_date) : 'Reported ' + long(h.report_date)) +
          (pos(n.head) ? ' · ' + n.head.toLocaleString('en-US') + ' head' : ''), change: null, killed: killed, head: pos(n.head) ? n.head : null },
      cutout: null, chart: null
    };
    var c = doc.cutout;
    if (c && iso(c.date) && pos(c.carcass) && !stale(c.date, nowMs)) {
      var cc = typeof c.change === 'number' && isFinite(c.change) ? Math.round(c.change * 100) / 100 : null;
      out.cutout = { val: money(c.carcass), date: c.date, meta: long(c.date),
        change: cc === null ? null : (cc ? (cc > 0 ? 'Up ' : 'Down ') + money(Math.abs(cc)) + ' on the day' : 'Unchanged on the day'), down: cc !== null && cc < 0 };
    }
    var newest = out.cutout && out.cutout.date > h.report_date ? out.cutout.date : h.report_date;
    var hs = withDay(series(hist.hogs, 'base', newest, HOLD_DAYS), h.report_date, n.base);
    var prev = hs.filter(function (p) { return p.d < h.report_date; }).pop();
    if (prev) out.hogs.change = { by: n.base - prev.v, since: prev.d };
    var cs = out.cutout ? withDay(series(hist.cutout, 'carcass', newest, HOLD_DAYS), c.date, c.carcass) : [];
    var ly = [];
    (Array.isArray(hist.hogs_ly) ? hist.hogs_ly : []).forEach(function (e) {
      var d = e && iso(e.d) && nextYear(e.d);
      if (d && pos(e.base) && d <= newest && d > isoOf(utc(newest) - HOLD_DAYS * 864e5)) ly.push({ d: d, v: e.base, was: e.d });
    });
    ly.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    if (hs.length >= CHART_MIN) out.chart = { hogs: hs, cutout: cs.length >= CHART_MIN ? cs : [], ly: ly.length >= CHART_MIN ? ly : [], to: newest };
    return out;
  }

  /* the chart's series and bands for the kit (components/ag-chart.js) */
  function config(v) {
    var ch = v.chart;
    return {
      series: [
        { key: 'cutout', name: 'Cutout', points: ch.cutout, color: 'var(--hc2)', card: '#5ea4ea' },
        { key: 'hogs', name: 'Cash hogs', points: ch.hogs, color: 'var(--hc1)', card: '#e0ac45' },
        { key: 'ly', name: 'Cash hogs a year ago', points: ch.ly, faint: true, note: 'Cash hogs a year ago' }
      ],
      bands: [{ a: 'cutout', b: 'hogs', color: 'var(--hc2)', opacity: 'var(--hc-gap-op)', card: '#5ea4ea', cardOpacity: 0.26,
        end: function (p) { return 'Gap ' + money(Math.abs(p.v)); },
        start: function (p) { return 'Gap ' + money(Math.abs(p.v)) + ' on ' + short(p.d); } }],
      unit: '$/cwt',
      ranges: RANGES.map(function (r) { return { label: r[0], days: r[1], aria: r[2] }; }),
      range: '3M', minPoints: CHART_MIN, height: { phone: 185, wide: 280 },
      story: story,
      readout: function (view, d) {
        var H = keyOf(view, 'hogs'), C = keyOf(view, 'cutout');
        var h = H.points.filter(function (p) { return p.d === d; })[0], c = C.points.filter(function (p) { return p.d === d; })[0];
        if (!h) return '';
        return short(d) + ' · hogs ' + money(h.v) + (c ? ' · cutout ' + money(c.v) + ' · gap ' + money(Math.abs(c.v - h.v)) : '');
      },
      share: { url: PAGE, title: 'Cash hogs and pork cutout', file: 'agsist-cash-hogs-' + v.hogs.date + '.png', kicker: 'Cash hogs and pork cutout', date: ch.to,
        source: '$ per cwt, carcass · cash hogs: national negotiated base, barrows and gilts · pork cutout: negotiated · USDA AMS' }
    };
  }
  function keyOf(view, k) { return view.series.filter(function (s) { return s.key === k; })[0] || { points: [] }; }
  function gapsOf(view) { var K = root.AgChart || KIT; return K.pairs(view, { a: 'cutout', b: 'hogs' }); }

  /* the headline, the takeaway and the summary sentence, all from the range shown */
  function story(view) {
    var hs = keyOf(view, 'hogs').points, cs = keyOf(view, 'cutout').points;
    if (!hs.length) return { head: '', take: '', summary: '' };
    var h0 = hs[0], h1 = hs[hs.length - 1], by = Math.round((h1.v - h0.v) * 100) / 100;
    var head = 'Cash hogs ' + (by ? (by < 0 ? 'fell ' : 'rose ') + money(Math.abs(by)) + ' (' + Math.round(Math.abs(by) / h0.v * 100) + '%)' : 'were unchanged') + ' since ' + short(h0.d);
    if (cs.length) {
      var vs = cs.map(function (p) { return p.v; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
      var mean = vs.reduce(function (a, b) { return a + b; }, 0) / vs.length, c0 = cs[0], cb = Math.round((cs[cs.length - 1].v - c0.v) * 100) / 100;
      head += (hi - lo) / mean <= 0.08
        ? ' while the pork cutout stayed between $' + Math.round(lo) + ' and $' + Math.round(hi)
        : ' while the pork cutout ' + (cb ? (cb < 0 ? 'fell ' : 'rose ') + money(Math.abs(cb)) + ' (' + Math.round(Math.abs(cb) / c0.v * 100) + '%)' : 'was unchanged');
    }
    var g = gapsOf(view), take = '';
    if (g.length >= 2) {
      var g0 = g[0], g1 = g[g.length - 1], d = Math.round((g1.v - g0.v) * 100) / 100;
      take = 'The pork cutout is ' + money(Math.abs(g1.v)) + (g1.v >= 0 ? ' above' : ' below') + ' cash hogs on ' + short(g1.d) + ', ' +
        (d ? (d > 0 ? 'up' : 'down') + ' from ' + money(Math.abs(g0.v)) + ' on ' + short(g0.d) : 'the same as on ' + short(g0.d)) + '.';
    }
    return { head: head + '.', take: take,
      summary: head + '. ' + (take ? take + ' ' : '') + 'Latest: cash hogs ' + money(h1.v) + ' on ' + long(h1.d) +
        (cs.length ? ', pork cutout ' + money(cs[cs.length - 1].v) + ' on ' + long(cs[cs.length - 1].d) : '') + '. Dollars per hundredweight, carcass. Source: USDA AMS.' };
  }

  /* ---------------------------------------------------------------- the block */
  function changeLine(ch) {
    if (!ch) return '';
    var by = Math.round(ch.by * 100) / 100;
    if (!by) return 'Unchanged from ' + short(ch.since);
    return (by > 0 ? 'Up ' : 'Down ') + money(Math.abs(by)) + ' from ' + short(ch.since);
  }
  function meta(v) {
    return 'Cash hogs: national negotiated base price for barrows and gilts. ' + esc(v.hogs.meta) + '.' +
      (v.cutout ? ' Pork cutout: negotiated sales, ' + esc(v.cutout.meta) + '.' : '') + ' Source: USDA AMS.';
  }
  function caption(v) {
    var k = [v.hogs.killed.length ? 'killed ' + v.hogs.killed.map(short).join(' and ') : '', v.hogs.head ? v.hogs.head.toLocaleString('en-US') + ' head' : ''].filter(Boolean).join(', ');
    return 'Cash hogs: national negotiated base price, barrows and gilts' + (k ? ' (' + esc(k) + ')' : '') + '. Pork cutout: negotiated sales. Source: USDA AMS, ' + esc(long(v.chart.to)) + '.';
  }
  function html(v) {
    if (v.chart) {
      var K = root.AgChart || KIT, st = story(K.slice(config(v), 92));
      return '<h3 class="hc-head">' + esc(st.head) + '</h3><p class="hc-take">' + esc(st.take) + '</p>' +
        '<figure class="hc-fig"><div class="hc-chart"></div><figcaption class="ct-read">' + caption(v) +
        (tradingDays(v.chart.hogs[0].d, v.chart.to) < FULL_DAYS ? ' History so far: ' + v.chart.hogs.length + ' report days.' : '') +
        ' Tap a name to hide or show its line.</figcaption></figure>';
    }
    var s = ['<div class="hc-figs">'];
    s.push('<div class="hc-fg"><span class="lbl">Cash hogs</span><div class="ct-price">' + esc(v.hogs.val) + '</div>' +
      (v.hogs.change ? '<div class="hc-chg ' + (v.hogs.change.by < 0 ? 'dn' : 'up') + '">' + esc(changeLine(v.hogs.change)) + '</div>' : '') + '</div>');
    if (v.cutout) s.push('<div class="hc-fg"><span class="lbl">Pork cutout</span><div class="ct-price">' + esc(v.cutout.val) + '</div>' +
      (v.cutout.change ? '<div class="hc-chg ' + (v.cutout.down ? 'dn' : 'up') + '">' + esc(v.cutout.change) + '</div>' : '') + '</div>');
    s.push('<p class="ct-read hc-meta">' + meta(v) + '</p></div>');
    return s.join('');
  }

  function render(box, doc, nowMs) {
    var v = view(doc, nowMs);
    var body = box && box.querySelector('.hc-body');
    if (!v || !body) { if (box) box.hidden = true; return null; }
    body.innerHTML = html(v);
    box.classList.toggle('hc-has-chart', !!v.chart);
    box.hidden = false;
    var K = root.AgChart;
    if (v.chart && K) {
      var cfg = config(v);
      cfg.headEl = body.querySelector('.hc-head'); cfg.takeEl = body.querySelector('.hc-take'); cfg.tools = box.querySelector('.hc-tools');
      K.mount(body.querySelector('.hc-chart'), cfg);
    }
    return v;
  }

  var KIT = root.AgChart || (typeof require === 'function' ? require('./ag-chart.js') : null);
  var api = { view: view, render: render, config: config, story: story, html: html, tradingDays: tradingDays, stale: stale, STALE_TRADING_DAYS: STALE_TRADING_DAYS };
  root.AgHogCash = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root.document && root.fetch) {
    var start = function () {
      var box = root.document.getElementById('hog-cash'); if (!box) return;
      root.fetch('/data/hog-cash.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }).then(function (d) { render(box, d, Date.now()); });
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start); else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
