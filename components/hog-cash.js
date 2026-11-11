/* components/hog-cash.js: the cash hog block on /cattle-futures-prices (Nov 11, 2026).
   Reads data/hog-cash.json (USDA AMS: National Daily Direct Hog Prior Day Report, negotiated
   barrows and gilts, and the National Daily Pork Report, negotiated afternoon cutout).
   - Nothing shows until the file has a hog price; the section ships hidden and empty.
   - A hog report more than 5 trading days old hides the whole block (a weekday count from the
     report day to today in Central time; holidays count as trading days, so it hides early, never late).
   - The cutout has its own date and the same limit; an old cutout drops out alone.
   - The chart draws the last 30 days of report days held in the file's history, one price axis
     ($/cwt carcass, both lines are on the same scale), dated ticks, a point readout on hover and tap,
     and a save-the-picture button. Fewer than 5 days held: no chart, the two figures use the width.
   Exports window.AgHogCash (and module.exports for the tests). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var STALE_TRADING_DAYS = 5, CHART_DAYS = 30, CHART_MIN = 5;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function iso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null; }
  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
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

  function series(list, key, newest) {
    var cut = new Date(utc(newest) - CHART_DAYS * 864e5).toISOString().slice(0, 10), seen = {};
    (Array.isArray(list) ? list : []).forEach(function (e) {
      if (e && iso(e.d) && e.d > cut && e.d <= newest && pos(e[key])) seen[e.d] = e[key];
    });
    return Object.keys(seen).sort().map(function (d) { return { d: d, v: seen[d] }; });
  }

  /* What the block shows, or null to keep it hidden. */
  function view(doc, nowMs) {
    var h = doc && doc.hogs, n = h && h.negotiated;
    if (!h || !n || !iso(h.report_date) || !pos(n.base)) return null;
    if (stale(h.report_date, nowMs)) return null;
    var hist = doc.history || {};
    var hs = series(hist.hogs, 'base', h.report_date);
    if (!hs.length || hs[hs.length - 1].d !== h.report_date) hs = hs.filter(function (p) { return p.d !== h.report_date; }).concat([{ d: h.report_date, v: n.base }]);
    var killed = (h.slaughter_dates || []).filter(iso).sort();
    var prev = hs.length > 1 ? hs[hs.length - 2] : null;
    var out = {
      hogs: {
        val: money(n.base), date: h.report_date,
        meta: (killed.length ? 'Hogs killed ' + killed.map(short).join(' and ') + ', reported ' + long(h.report_date) : 'Reported ' + long(h.report_date)) +
          (pos(n.head) ? ' · ' + n.head.toLocaleString('en-US') + ' head' : ''),
        change: prev ? { by: n.base - prev.v, since: prev.d } : null
      },
      cutout: null, chart: null
    };
    var c = doc.cutout;
    if (c && iso(c.date) && pos(c.carcass) && !stale(c.date, nowMs)) {
      var cc = typeof c.change === 'number' && isFinite(c.change) ? Math.round(c.change * 100) / 100 : null;
      out.cutout = { val: money(c.carcass), date: c.date, meta: long(c.date),
        change: cc === null ? null : (cc ? (cc > 0 ? 'Up ' : 'Down ') + money(Math.abs(cc)) + ' on the day' : 'Unchanged on the day'), down: cc !== null && cc < 0 };
    }
    var newest = out.cutout && out.cutout.date > h.report_date ? out.cutout.date : h.report_date;
    var cs = out.cutout ? series(hist.cutout, 'carcass', newest) : [];
    if (out.cutout && (!cs.length || cs[cs.length - 1].d !== c.date)) cs = cs.filter(function (p) { return p.d !== c.date; }).concat([{ d: c.date, v: c.carcass }]);
    hs = series(hs.map(function (p) { return { d: p.d, base: p.v }; }), 'base', newest);
    if (hs.length >= CHART_MIN) out.chart = { hogs: hs, cutout: cs.length >= CHART_MIN ? cs : [], from: hs[0].d, to: newest };
    return out;
  }

  /* ---------------------------------------------------------------- the chart (SVG, pixel sized) */
  function ticks(lo, hi, n) {
    var span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), st = mag;
    [1, 2, 2.5, 5, 10].some(function (m) { st = m * mag; return st >= raw; });
    var out = [], t = Math.ceil(lo / st) * st;
    for (; t <= hi + 1e-9; t += st) out.push(+t.toFixed(6));
    return out;
  }
  function geom(ch, W, H) {
    var all = ch.hogs.concat(ch.cutout).map(function (p) { return p.v; });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = Math.max((hi - lo) * 0.12, 1);
    lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
    var L = W < 420 ? 46 : 54, R = W < 420 ? 12 : 18, T = 26, B = 30;
    var t0 = utc(ch.from), t1 = utc(ch.to), dt = Math.max(t1 - t0, 864e5);
    return {
      L: L, R: R, T: T, B: B, W: W, H: H, lo: lo, hi: hi,
      x: function (d) { return L + (utc(d) - t0) / dt * (W - L - R); },
      y: function (v) { return T + (hi - v) / (hi - lo) * (H - T - B); }
    };
  }
  function dateTicks(ch, g) {
    var t0 = utc(ch.from), t1 = utc(ch.to), want = g.W < 420 ? 3 : 6, step = Math.max(1, Math.round((t1 - t0) / 864e5 / (want - 1)));
    var out = [];
    for (var t = t1; t >= t0; t -= step * 864e5) out.unshift(new Date(t).toISOString().slice(0, 10));
    return out;
  }
  function path(pts, g) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + g.x(p.d).toFixed(1) + ' ' + g.y(p.v).toFixed(1); }).join(''); }

  function svg(ch, W, H) {
    var g = geom(ch, W, H), s = [];
    s.push('<svg class="hc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cash hog price' + (ch.cutout.length ? ' and pork cutout' : '') + ', ' + long(ch.from) + ' to ' + long(ch.to) + ', dollars per hundredweight, carcass">');
    s.push('<text class="hc-ax-t" x="' + (g.L - 6) + '" y="12" text-anchor="end">$/cwt</text>');
    var kx = W - g.R;
    if (ch.cutout.length) { s.push('<text class="hc-key-t" x="' + kx + '" y="12" text-anchor="end">Pork cutout</text><line class="hc-l2 hc-key-l" x1="' + (kx - 92) + '" x2="' + (kx - 76) + '" y1="8" y2="8"/>'); kx -= 104; }
    s.push('<text class="hc-key-t" x="' + kx + '" y="12" text-anchor="end">Cash hogs</text><line class="hc-l1 hc-key-l" x1="' + (kx - 80) + '" x2="' + (kx - 64) + '" y1="8" y2="8"/>');
    ticks(g.lo, g.hi, 4).forEach(function (v) {
      var y = g.y(v).toFixed(1);
      s.push('<line class="hc-grid" x1="' + g.L + '" x2="' + (W - g.R) + '" y1="' + y + '" y2="' + y + '"/>');
      s.push('<text class="hc-ax" x="' + (g.L - 6) + '" y="' + y + '" dy=".32em" text-anchor="end">$' + (v % 1 ? v.toFixed(1) : v) + '</text>');
    });
    dateTicks(ch, g).forEach(function (d, i, a) {
      var x = g.x(d), anchor = i === a.length - 1 ? 'end' : (i === 0 && x - g.L < 20 ? 'start' : 'middle');
      s.push('<text class="hc-ax" x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + short(d) + '</text>');
    });
    s.push('<line class="hc-base" x1="' + g.L + '" x2="' + (W - g.R) + '" y1="' + (H - g.B) + '" y2="' + (H - g.B) + '"/>');
    [['cutout', 'hc-l2'], ['hogs', 'hc-l1']].forEach(function (k) {
      var pts = ch[k[0]]; if (!pts.length) return;
      s.push('<path class="' + k[1] + '" d="' + path(pts, g) + '"/>');
      var e = pts[pts.length - 1];
      s.push('<circle class="' + k[1] + 'd" cx="' + g.x(e.d).toFixed(1) + '" cy="' + g.y(e.v).toFixed(1) + '" r="4"/>');
    });
    s.push('<g class="hc-hover" visibility="hidden"><line class="hc-cross" y1="' + g.T + '" y2="' + (H - g.B) + '"/><circle class="hc-l1d" r="4"/><circle class="hc-l2d" r="4"/></g>');
    s.push('<rect class="hc-hit" x="' + g.L + '" y="' + g.T + '" width="' + (W - g.L - g.R) + '" height="' + (H - g.T - g.B) + '" fill="transparent"/>');
    s.push('</svg>');
    return s.join('');
  }

  function nearest(pts, d) {
    var best = null;
    pts.forEach(function (p) { if (!best || Math.abs(utc(p.d) - utc(d)) < Math.abs(utc(best.d) - utc(d))) best = p; });
    return best;
  }

  /* ---------------------------------------------------------------- save the picture (PNG) */
  function picture(doc, v) {
    var ch = v.chart, W = 1200, H = 675, c = doc.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); if (!x) return null;
    var F = "Inter, system-ui, sans-serif";
    x.fillStyle = '#0a0c0d'; x.fillRect(0, 0, W, H); x.fillStyle = '#d4a23f'; x.fillRect(0, 0, W, 10);
    x.fillStyle = '#e9edeb'; x.font = '800 40px ' + F; x.fillText('Cash hogs, national negotiated: ' + v.hogs.val + '/cwt', 56, 78);
    x.fillStyle = 'rgba(233,237,235,.82)'; x.font = '400 24px ' + F;
    x.fillText(v.hogs.meta + (v.cutout ? ' · Pork cutout ' + v.cutout.val + ' (' + short(v.cutout.date) + ')' : ''), 56, 118);
    var g = geom(ch, W - 80, H - 230), ox = 40, oy = 150;
    x.font = '400 20px ' + F; x.textAlign = 'right';
    ticks(g.lo, g.hi, 4).forEach(function (t) {
      var y = oy + g.y(t); x.strokeStyle = 'rgba(233,237,235,.14)'; x.lineWidth = 1; x.beginPath(); x.moveTo(ox + g.L, y); x.lineTo(ox + g.W - g.R, y); x.stroke();
      x.fillStyle = 'rgba(233,237,235,.75)'; x.fillText('$' + t, ox + g.L - 8, y + 7);
    });
    x.textAlign = 'center';
    dateTicks(ch, g).forEach(function (d) { x.fillText(short(d), ox + g.x(d), oy + g.H - 4); });
    [['cutout', '#4f94d8'], ['hogs', '#d4a23f']].forEach(function (k) {
      var pts = ch[k[0]]; if (!pts.length) return;
      x.strokeStyle = k[1]; x.lineWidth = 4; x.beginPath();
      pts.forEach(function (p, i) { var px = ox + g.x(p.d), py = oy + g.y(p.v); if (i) x.lineTo(px, py); else x.moveTo(px, py); }); x.stroke();
    });
    x.textAlign = 'left'; x.font = '600 20px ' + F;
    x.fillStyle = '#d4a23f'; x.fillText('Cash hogs', 56, H - 34);
    if (ch.cutout.length) { x.fillStyle = '#4f94d8'; x.fillText('Pork cutout', 186, H - 34); }
    x.fillStyle = 'rgba(233,237,235,.82)'; x.font = '400 18px ' + F; x.textAlign = 'right';
    x.fillText('$ per cwt, carcass · USDA AMS · agsist.com/cattle-futures-prices', W - 40, H - 34);
    return c;
  }
  function save(doc, v) {
    var c = picture(doc, v); if (!c || !c.toBlob) return;
    c.toBlob(function (b) {
      if (!b) return;
      var a = doc.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'agsist-cash-hogs-' + v.hogs.date + '.png';
      doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      try { if (typeof root.gtag === 'function') root.gtag('event', 'picture_download', { kit: 'hog-cash' }); } catch (e) {}
    }, 'image/png');
  }

  /* ---------------------------------------------------------------- the block */
  function changeLine(ch) {
    if (!ch) return '';
    var by = Math.round(ch.by * 100) / 100;
    if (!by) return 'Unchanged from ' + short(ch.since);
    return (by > 0 ? 'Up ' : 'Down ') + money(Math.abs(by)) + ' from ' + short(ch.since);
  }
  function html(v) {
    var s = [];
    s.push('<div class="hc-figs">');
    s.push('<div class="hc-fg"><span class="lbl">Cash hogs</span><div class="ct-price">' + esc(v.hogs.val) + '</div>' +
      (v.hogs.change ? '<div class="hc-chg ' + (v.hogs.change.by < 0 ? 'dn' : 'up') + '">' + esc(changeLine(v.hogs.change)) + '</div>' : '') + '</div>');
    if (v.cutout) s.push('<div class="hc-fg"><span class="lbl">Pork cutout</span><div class="ct-price">' + esc(v.cutout.val) + '</div>' +
      (v.cutout.change ? '<div class="hc-chg ' + (v.cutout.down ? 'dn' : 'up') + '">' + esc(v.cutout.change) + '</div>' : '') + '</div>');
    s.push('<p class="ct-read hc-meta">Cash hogs: national negotiated base price for barrows and gilts. ' + esc(v.hogs.meta) + '.' +
      (v.cutout ? ' Pork cutout: negotiated sales, ' + esc(v.cutout.meta) + '.' : '') + ' Source: USDA AMS.</p>');
    s.push('</div>');
    if (v.chart) {
      s.push('<figure class="hc-fig"><div class="hc-plot"></div><span class="hc-read" aria-live="polite"></span>' +
        '<div class="hc-foot"><figcaption class="ct-read">' + esc(short(v.chart.from)) + ' to ' + esc(long(v.chart.to)) + ', report days</figcaption><button type="button" class="hc-save">Save the picture</button></div></figure>');
    }
    return s.join('');
  }

  function render(box, doc, nowMs) {
    var v = view(doc, nowMs);
    var body = box && box.querySelector('.hc-body');
    if (!v || !body) { if (box) box.hidden = true; return null; }
    body.innerHTML = html(v);
    box.classList.toggle('hc-has-chart', !!v.chart);
    box.hidden = false;
    if (v.chart) {
      var plot = body.querySelector('.hc-plot'), read = body.querySelector('.hc-read'), lastW = 0;
      var draw = function () {
        var W = Math.round(plot.clientWidth); if (!W || W === lastW) return; lastW = W;
        var H = W < 420 ? 160 : 230;
        plot.innerHTML = svg(v.chart, W, H); plot.appendChild(read);
        var g = geom(v.chart, W, H), hov = plot.querySelector('.hc-hover'), hit = plot.querySelector('.hc-hit');
        var move = function (ev) {
          var r = hit.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left + g.L;
          var t0 = utc(v.chart.from), t1 = utc(v.chart.to), dt = Math.max(t1 - t0, 864e5);
          var d = new Date(t0 + (cx - g.L) / (W - g.L - g.R) * dt).toISOString().slice(0, 10);
          var p = nearest(v.chart.hogs, d); if (!p) return;
          var q = v.chart.cutout.length ? nearest(v.chart.cutout, p.d) : null; if (q && q.d !== p.d) q = null;
          var X = g.x(p.d).toFixed(1), kids = hov.children;
          kids[0].setAttribute('x1', X); kids[0].setAttribute('x2', X);
          kids[1].setAttribute('cx', X); kids[1].setAttribute('cy', g.y(p.v).toFixed(1));
          kids[2].setAttribute('visibility', q ? 'visible' : 'hidden');
          if (q) { kids[2].setAttribute('cx', X); kids[2].setAttribute('cy', g.y(q.v).toFixed(1)); }
          hov.setAttribute('visibility', 'visible'); plot.classList.add('hc-on');
          read.textContent = short(p.d) + ': hogs ' + money(p.v) + (q ? ', cutout ' + money(q.v) : '');
        };
        hit.addEventListener('mousemove', move); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('touchmove', move, { passive: true });
        hit.addEventListener('mouseleave', function () { hov.setAttribute('visibility', 'hidden'); plot.classList.remove('hc-on'); read.textContent = ''; });
      };
      draw();
      if (root.ResizeObserver) new root.ResizeObserver(draw).observe(plot); else root.addEventListener('resize', draw);
      var btn = body.querySelector('.hc-save');
      if (btn) btn.addEventListener('click', function () { save(box.ownerDocument, v); });
    }
    return v;
  }

  var api = { view: view, render: render, svg: svg, tradingDays: tradingDays, stale: stale, html: html, STALE_TRADING_DAYS: STALE_TRADING_DAYS };
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
