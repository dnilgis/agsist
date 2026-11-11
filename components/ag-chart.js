/* components/ag-chart.js: the shared chart kit (Nov 11, 2026). Every chart on the site meets one bar:
   a headline computed from the data, lines named at their right end with the latest value, labelled
   axes and dates, the latest point marked, a hover / tap readout, a Share button and a save-the-picture
   card that stands alone, keyboard and screen reader use, reduced motion respected, a reserved height.
   Plain SVG and JS, no library. Styles: components/ag-chart.css. First user: components/hog-cash.js.

   AgChart.mount(el, cfg) draws into el (an empty element) and returns { redraw, state }.
   cfg:
     series   [{ key, name, points: [{ d: 'YYYY-MM-DD', v: number }], color: CSS colour for the page,
                 card: colour for the picture, faint: true (dashed, muted, no end label, drawn under),
                 note: a label at the series' first point (faint lines), toggle: false (no hide/show) }]
     bands    [{ a: key, b: key, color, card, opacity, cardOpacity,
                 end(p), start(p): label text for the band's last and first shared day,
                 p = { d, a, b, v: a minus b } }]   the shaded area between two series
     fmt      v -> text for values (default '$' + 2 decimals); tick(v) -> axis text (default '$' + v)
     unit     axis unit, top left ('$/cwt')
     ranges   [{ label: '3M', days: 92, aria: 'three months' }], days 0 = all held; a button shows only
              when the held days run past it and leave minPoints in it; 'All' always
     range    the label to open on (falls back to the longest shown)
     minPoints  fewest points a drawn series needs (5)
     story(view) -> { head, take, summary }  from the range shown; view = { series, from, to, days }
              head and take go into cfg.headEl / cfg.takeEl, summary is the SVG's aria-label
     readout(view, day) -> text for the readout line (default: each series' value that day)
     height   { phone: 200, wide: 280 }   reserved in CSS too (ag-chart.css), so nothing shifts
     tools    element for the Share / Copy link and Save the picture buttons (optional)
     share    { url, title, file: 'name.png', kicker: card top line, source: card foot line,
                date: 'YYYY-MM-DD' shown on the card }
   AgChart.svg(view, W, H, opt) and AgChart.card(cfg, view, done(blob)) are the two drawers;
   AgChart.slice(cfg, days) and AgChart.pairs(view, band) are the helpers the tests use.
   Exports window.AgChart (and module.exports). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
  var PAGE = { ink: 'var(--text)', dim: 'var(--text-dim)', mut: 'var(--text-muted)', grid: 'var(--border)', surf: 'var(--surface)' };
  var CARD = { ink: '#e9edeb', dim: 'rgba(233,237,235,.78)', mut: 'rgba(233,237,235,.55)', grid: 'rgba(233,237,235,.13)', surf: '#0a0c0d' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function utc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }
  function short(s) { return MON[+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10)); }
  function long(s) { return short(s) + ', ' + s.slice(0, 4); }
  function money(v) { return '$' + v.toFixed(2); }
  function fmtOf(cfg) { return cfg.fmt || money; }

  /* ------------------------------------------------------------ data */
  function lastDay(cfg) { var t = ''; cfg.series.forEach(function (s) { if (!s.faint && s.points.length) t = s.points[s.points.length - 1].d > t ? s.points[s.points.length - 1].d : t; }); return t; }
  function slice(cfg, days) {
    var to = lastDay(cfg), cut = days ? isoOf(utc(to) - days * 864e5) : '', min = cfg.minPoints || 5;
    var series = cfg.series.map(function (s) {
      var pts = s.points.filter(function (p) { return p.d > cut && p.d <= to; });
      return Object.assign({}, s, { points: pts.length >= min ? pts : [] });
    });
    var from = to;
    series.forEach(function (s) { if (!s.faint && s.points.length && s.points[0].d < from) from = s.points[0].d; });
    return { series: series, from: from, to: to, days: days };
  }
  function ser(view, key) { return view.series.filter(function (s) { return s.key === key; })[0]; }
  function pairs(view, band) {
    var A = ser(view, band.a), B = ser(view, band.b); if (!A || !B) return [];
    var m = {}; B.points.forEach(function (p) { m[p.d] = p.v; });
    return A.points.filter(function (p) { return m[p.d] != null; }).map(function (p) { return { d: p.d, a: p.v, b: m[p.d], v: p.v - m[p.d] }; });
  }
  function ranges(cfg) {
    var all = slice(cfg, 0), span = (utc(all.to) - utc(all.from)) / 864e5, out = [];
    (cfg.ranges || []).forEach(function (r) {
      if (!r.days) return;
      var v = slice(cfg, r.days);
      if (span > r.days && v.series.some(function (s) { return !s.faint && s.points.length; })) out.push(r);
    });
    out.push((cfg.ranges || []).filter(function (r) { return !r.days; })[0] || { label: 'All', days: 0, aria: 'all days held' });
    return out;
  }
  function near(pts, d) { var b = null; pts.forEach(function (p) { if (!b || Math.abs(utc(p.d) - utc(d)) < Math.abs(utc(b.d) - utc(d))) b = p; }); return b; }
  function readout(cfg, view, d) {
    if (cfg.readout) return cfg.readout(view, d);
    var main = view.series.filter(function (s) { return !s.faint && s.points.length; }), p0 = near(main[0].points, d);
    return short(p0.d) + ': ' + main.map(function (s) { var p = near(s.points, p0.d); return p && p.d === p0.d ? s.name + ' ' + fmtOf(cfg)(p.v) : ''; }).filter(Boolean).join(' · ');
  }

  /* ------------------------------------------------------------ the SVG */
  function ticks(lo, hi, n) {
    var raw = (hi - lo || 1) / n, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), st = mag;
    [1, 2, 2.5, 5, 10].some(function (m) { st = m * mag; return st >= raw; });
    var out = []; for (var t = Math.ceil(lo / st) * st; t <= hi + 1e-9; t += st) out.push(+t.toFixed(6));
    return out;
  }
  function geom(view, W, H, fs, hide) {
    var all = [];
    view.series.forEach(function (s) { if (!hide[s.key]) s.points.forEach(function (p) { all.push(p.v); }); });
    if (!all.length) view.series.forEach(function (s) { s.points.forEach(function (p) { all.push(p.v); }); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = Math.max((hi - lo) * 0.03, 0.25);
    lo -= pad; hi += pad;
    var tk = ticks(lo, hi, 5), st = tk.length > 1 ? tk[1] - tk[0] : 1;   // the axis runs to a tick at both ends
    lo = Math.min(lo, Math.floor(lo / st) * st); hi = Math.max(hi, Math.ceil(hi / st) * st);
    var L = Math.round(fs * (W < 420 ? 3.4 : 3.9)), R = Math.round(fs * 0.8), T = Math.round(fs * 3), B = Math.round(fs * 2.2), lab = Math.round(fs * 1.8);
    var t0 = utc(view.from), dt = Math.max(utc(view.to) - t0, 864e5);
    return { L: L, R: R, T: T, B: B, W: W, H: H, fs: fs, lo: lo, hi: hi, base: H - B - fs * 0.6,
      x: function (d) { return L + (utc(d) - t0) / dt * (W - L - R); },
      y: function (v) { return T + (hi - v) / (hi - lo) * (H - T - B - lab); },
      day: function (px) { return isoOf(t0 + Math.round((px - L) / (W - L - R) * dt / 864e5) * 864e5); } };
  }
  function txt(x, y, s, st, anchor, cls) { return '<text' + (cls ? ' class="' + cls + '"' : '') + ' x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + ' style="' + st + '">' + esc(s) + '</text>'; }
  function path(pts, g) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + g.x(p.d).toFixed(1) + ' ' + g.y(p.v).toFixed(1); }).join(''); }

  /* opt: { fs, hide: {key: true}, card: true (literal colours), hover: true, label, cfg } */
  function svg(view, W, H, opt) {
    var fs = opt.fs || 12, hide = opt.hide || {}, P = opt.card ? CARD : PAGE, cfg = opt.cfg || {}, fmt = fmtOf(cfg);
    var col = function (s) { return opt.card ? s.card || s.color : s.color; };
    var g = geom(view, W, H, fs, hide), f = 'font-size:' + fs + 'px;font-family:' + FONT + ';', fb = f + 'font-weight:700;', o = [];
    var halo = 'paint-order:stroke;stroke:' + P.surf + ';stroke-width:' + (fs / 3.5).toFixed(1) + 'px;stroke-linejoin:round;';
    o.push('<svg xmlns="http://www.w3.org/2000/svg" class="agc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"' + (opt.label ? ' role="img" aria-label="' + esc(opt.label) + '"' : '') + '>');
    o.push(txt(g.L - fs * 0.5, fs * 1.2, cfg.unit || '', f + 'fill:' + P.mut, 'end'));
    ticks(g.lo, g.hi, W / fs < 40 ? 4 : 5).forEach(function (v) {
      var y = g.y(v);
      o.push('<line x1="' + g.L + '" x2="' + (W - g.R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" style="stroke:' + P.grid + ';stroke-width:1"/>');
      o.push(txt(g.L - fs * 0.5, y + fs * 0.35, cfg.tick ? cfg.tick(v) : '$' + (v % 1 ? v.toFixed(1) : v), f + 'fill:' + P.dim, 'end'));
    });
    o.push('<line x1="' + g.L + '" x2="' + (W - g.R) + '" y1="' + g.base.toFixed(1) + '" y2="' + g.base.toFixed(1) + '" style="stroke:' + P.mut + ';stroke-width:1"/>');
    var days = Math.round((utc(view.to) - utc(view.from)) / 864e5), want = Math.min(days + 1, W / fs < 40 ? 3 : 6), dts = [];
    for (var i = 0; i < want; i++) dts.push(isoOf(utc(view.from) + Math.round(i * days / Math.max(1, want - 1)) * 864e5));
    dts.forEach(function (d, i) { var x = g.x(d); o.push(txt(x, H - fs * 0.5, short(d), f + 'fill:' + P.dim, i === dts.length - 1 ? 'end' : (x - g.L < fs * 2 ? 'start' : 'middle'))); });
    var ex = g.x(view.to) - fs * 0.7, bandLabels = [];
    (cfg.bands || []).forEach(function (b) {
      if (hide[b.a] || hide[b.b]) return;
      var pp = pairs(view, b); if (pp.length < 2) return;
      var top = pp.map(function (p) { return g.x(p.d).toFixed(1) + ',' + g.y(p.a).toFixed(1); });
      var bot = pp.slice().reverse().map(function (p) { return g.x(p.d).toFixed(1) + ',' + g.y(p.b).toFixed(1); });
      o.push('<polygon class="agc-band" points="' + top.concat(bot).join(' ') + '" style="fill:' + (opt.card ? b.card || (ser(view, b.a) || {}).card || '#5ea4ea' : b.color) + ';fill-opacity:' + (opt.card ? b.cardOpacity || 0.26 : b.opacity || 0.2) + '"/>');
      var e = pp[pp.length - 1], s0 = pp[0];
      var room = function (p, k) { return Math.abs(g.y(p.a) - g.y(p.b)) >= fs * k; };
      if (b.end) bandLabels.push(txt(ex, room(e, 1.5) ? (g.y(e.a) + g.y(e.b)) / 2 + fs * 0.35 : g.y(Math.max(e.a, e.b)) - fs * 2.1, b.end(e), fb + halo + 'fill:' + P.ink, 'end', 'agc-bl'));
      if (b.start) bandLabels.push(txt(g.x(s0.d) + fs * 0.5, room(s0, 2.6) ? (g.y(s0.a) + g.y(s0.b)) / 2 + fs * 0.35 : g.y(Math.max(s0.a, s0.b)) - fs * 0.7, b.start(s0), f + halo + 'fill:' + P.ink, 'start', 'agc-bl'));
    });
    var lw = Math.max(2, fs / 6), labs = [];
    view.series.filter(function (s) { return s.faint; }).concat(view.series.filter(function (s) { return !s.faint; })).forEach(function (s) {
      if (!s.points.length) return;
      var e = s.points[s.points.length - 1];
      if (!s.faint) labs.push({ s: s, v: e.v });
      if (hide[s.key]) return;
      o.push('<path class="agc-ln" d="' + path(s.points, g) + '" style="fill:none;stroke:' + (s.faint ? P.mut : col(s)) + ';stroke-width:' + (s.faint ? Math.max(1.5, fs / 8) : lw) +
        (s.faint ? ';stroke-dasharray:' + fs / 3 + ' ' + fs / 3 : ';stroke-linejoin:round;stroke-linecap:round') + '"/>');
      if (s.faint) {   // its key sits on the top row, right, clear of the end labels
        if (s.note) {
          var kx = W - g.R, kw = s.note.length * fs * 0.55;
          o.push('<line x1="' + (kx - kw - fs * 2).toFixed(1) + '" x2="' + (kx - kw - fs * 0.6).toFixed(1) + '" y1="' + (fs * 0.85).toFixed(1) + '" y2="' + (fs * 0.85).toFixed(1) + '" style="stroke:' + P.mut + ';stroke-width:2;stroke-dasharray:' + fs / 3 + ' ' + fs / 4 + '"/>');
          o.push(txt(kx, fs * 1.2, s.note, f + 'fill:' + P.dim, 'end'));
        }
        return;
      }
      o.push('<circle cx="' + g.x(e.d).toFixed(1) + '" cy="' + g.y(e.v).toFixed(1) + '" r="' + (fs / 3 + 1).toFixed(1) + '" style="fill:' + col(s) + ';stroke:' + P.surf + ';stroke-width:2"/>');
    });
    o = o.concat(bandLabels);
    labs.sort(function (a, b) { return b.v - a.v; }).forEach(function (l, i) {
      var name = l.s.name + ' ' + fmt(l.v), off = hide[l.s.key];
      var y = Math.min(Math.max(i === 0 ? g.y(l.v) - fs * 0.75 : g.y(l.v) + fs * 1.45 + (i - 1) * fs * 1.4, g.T + fs * (0.3 + i * 1.4)), g.base - fs * 0.3);   // a hidden line's name stays on the plot
      var w = name.length * fs * 0.62, tog = l.s.toggle !== false && !opt.card;
      o.push('<g class="agc-tog"' + (tog ? ' data-k="' + esc(l.s.key) + '" tabindex="0" role="button" aria-pressed="' + !off + '" aria-label="' + (off ? 'Show ' : 'Hide ') + esc(name) + '"' : '') + '>' +
        (tog ? '<rect x="' + (ex - w).toFixed(1) + '" y="' + (y - fs * 1.1).toFixed(1) + '" width="' + (w + fs * 0.4).toFixed(1) + '" height="' + (fs * 1.5).toFixed(1) + '" fill="transparent"/>' : '') +
        txt(ex, y, name, fb + halo + 'fill:' + col(l.s) + (off ? ';opacity:.45;text-decoration:line-through' : ''), 'end') + '</g>');
    });
    if (opt.hover) {
      o.push('<g class="agc-hov" visibility="hidden"><line y1="' + g.T + '" y2="' + g.base.toFixed(1) + '" style="stroke:' + P.mut + ';stroke-dasharray:3 3"/>' +
        labs.map(function (l) { return '<circle r="4" data-k="' + esc(l.s.key) + '" style="fill:' + col(l.s) + ';stroke:' + P.surf + ';stroke-width:2"/>'; }).join('') + '</g>');
      o.push('<rect class="agc-hit" x="' + g.L + '" y="' + g.T + '" width="' + Math.max(0, W - g.L - g.R - fs * 9) + '" height="' + (g.base - g.T).toFixed(1) + '" fill="transparent"/>');
    }
    o.push('</svg>');
    return o.join('');
  }

  /* ------------------------------------------------------------ the picture: 1200 x 630 */
  function wrap(ctx, s, max) {
    var out = [], cur = '';
    String(s || '').split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (ctx.measureText(x).width > max && cur) { out.push(cur); cur = w; } else cur = x; });
    if (cur) out.push(cur);
    return out;
  }
  function card(cfg, view, done) {
    var D = root.document, W = 1200, H = 630, c = D.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); if (!x || !root.Image) { done(null); return; }
    var st = cfg.story ? cfg.story(view) : {}, sh = cfg.share || {};
    x.fillStyle = '#0a0c0d'; x.fillRect(0, 0, W, H); x.fillStyle = '#d4a23f'; x.fillRect(0, 0, W, 10);
    x.font = '800 34px ' + FONT; x.fillStyle = '#e9edeb'; x.fillText('agsist', 48, 62);
    var aw = x.measureText('agsist').width; x.font = '700 20px ' + FONT; x.fillStyle = '#d4a23f'; x.fillText('.com', 50 + aw, 62);
    x.font = '600 20px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.textAlign = 'right';
    x.fillText((sh.kicker ? sh.kicker + ' · ' : '') + long(sh.date || view.to), W - 48, 60); x.textAlign = 'left';
    x.font = '800 38px ' + FONT; x.fillStyle = '#e9edeb';
    var y = 118; wrap(x, st.head, W - 96).slice(0, 2).forEach(function (l) { x.fillText(l, 48, y); y += 46; });
    if (st.take) { x.font = '400 25px ' + FONT; x.fillStyle = 'rgba(233,237,235,.86)'; x.fillText(wrap(x, st.take, W - 96)[0], 48, y + 2); y += 34; }
    var img = new root.Image();
    img.onload = function () {
      x.drawImage(img, 24, y + 4);
      x.font = '400 18px ' + FONT; x.fillStyle = 'rgba(233,237,235,.72)'; x.fillText(wrap(x, sh.source || '', W - 96)[0] || '', 48, H - 46);
      x.font = '700 20px ' + FONT; x.fillStyle = '#d4a23f'; x.fillText(String(sh.url || '').replace(/^https?:\/\//, ''), 48, H - 18);
      c.toBlob(function (b) { done(b); }, 'image/png');
    };
    img.onerror = function () { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(view, W - 64, H - y - 76, { fs: 22, card: true, cfg: cfg }));
  }
  function ga(n, kit) { try { if (typeof root.gtag === 'function') root.gtag('event', n, { kit: kit }); } catch (e) {} }

  /* ------------------------------------------------------------ mount */
  function mount(el, cfg) {
    var D = el.ownerDocument, rs = ranges(cfg), cur = rs.filter(function (r) { return r.label === cfg.range; })[0] || rs[rs.length - 1];
    var hide = {}, lastW = 0, view = null, animated = false, kit = (cfg.share && cfg.share.file) || 'chart';
    var reduce = false; try { reduce = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    el.classList.add('agc');
    el.innerHTML = (rs.length > 1 ? '<div class="agc-ctl" role="group" aria-label="Range">' + rs.map(function (r) {
      return '<button type="button" class="agc-rg" data-days="' + r.days + '" aria-pressed="' + (r === cur) + '" aria-label="Show ' + esc(r.aria || r.label) + '">' + esc(r.label) + '</button>';
    }).join('') + '</div>' : '') + '<div class="agc-plot"></div><p class="agc-read" aria-live="polite"></p>';
    var plot = el.querySelector('.agc-plot'), read = el.querySelector('.agc-read'), hh = cfg.height || {};
    var fit = function () { plot.style.height = (el.clientWidth < 520 ? hh.phone || 200 : hh.wide || 280) + 'px'; };
    fit();
    var latest = function () { read.textContent = readout(cfg, view, view.to); };
    function draw(force) {
      var W = Math.round(plot.clientWidth); if (!W || (W === lastW && !force)) return; lastW = W;
      fit();
      var H = W < 520 ? hh.phone || 200 : hh.wide || 280, fs = W < 520 ? 11.5 : 13;
      view = slice(cfg, cur.days);
      var st = cfg.story ? cfg.story(view) : {};
      if (cfg.headEl) cfg.headEl.textContent = st.head || '';
      if (cfg.takeEl) cfg.takeEl.textContent = st.take || '';
      plot.innerHTML = svg(view, W, H, { fs: fs, hide: hide, hover: true, label: st.summary, cfg: cfg });
      latest();
      var g = geom(view, W, H, fs, hide), hov = plot.querySelector('.agc-hov'), hit = plot.querySelector('.agc-hit');
      var move = function (ev) {
        var r = plot.getBoundingClientRect(), d = g.day((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left);
        var main = view.series.filter(function (s) { return !s.faint && s.points.length; }), p0 = near(main[0].points, d), X = g.x(p0.d).toFixed(1);
        hov.firstChild.setAttribute('x1', X); hov.firstChild.setAttribute('x2', X);
        [].slice.call(hov.querySelectorAll('circle')).forEach(function (cEl) {
          var s = ser(view, cEl.getAttribute('data-k')), p = s && near(s.points, p0.d), on = p && p.d === p0.d && !hide[s.key];
          cEl.setAttribute('visibility', on ? 'visible' : 'hidden');
          if (on) { cEl.setAttribute('cx', X); cEl.setAttribute('cy', g.y(p.v).toFixed(1)); }
        });
        hov.setAttribute('visibility', 'visible'); read.textContent = readout(cfg, view, p0.d);
      };
      hit.addEventListener('mousemove', move); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('touchmove', move, { passive: true });
      hit.addEventListener('mouseleave', function () { hov.setAttribute('visibility', 'hidden'); latest(); });
      [].slice.call(plot.querySelectorAll('.agc-tog[data-k]')).forEach(function (t) {
        var flip = function () { var k = t.getAttribute('data-k'); hide[k] = !hide[k]; draw(true); var n = plot.querySelector('.agc-tog[data-k="' + k + '"]'); if (n) n.focus(); };
        t.addEventListener('click', flip);
        t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
      });
      if (!animated && !reduce) {
        animated = true;
        var run = function () {
          plot.classList.add('agc-in');
          [].slice.call(plot.querySelectorAll('.agc-ln')).forEach(function (p) {
            var L = p.getTotalLength ? p.getTotalLength() : 0, dash = p.style.strokeDasharray; if (!L || dash) return;   // dashed lines fade in with the band
            p.style.strokeDasharray = L; p.style.strokeDashoffset = L; p.getBoundingClientRect();
            p.style.transition = 'stroke-dashoffset 1.1s ease-out'; p.style.strokeDashoffset = '0';
            setTimeout(function () { p.style.transition = p.style.strokeDasharray = p.style.strokeDashoffset = ''; }, 1300);
          });
        };
        plot.classList.add('agc-pre');
        if (root.IntersectionObserver) {
          var io = new root.IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); run(); } }, { threshold: 0.35 });
          io.observe(plot);
        } else run();
      }
    }
    [].slice.call(el.querySelectorAll('.agc-rg')).forEach(function (b, i, all) {
      b.addEventListener('click', function () {
        all.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        cur = rs.filter(function (r) { return String(r.days) === b.getAttribute('data-days'); })[0]; draw(true); ga('chart_range', kit);
      });
    });
    draw();
    if (root.ResizeObserver) new root.ResizeObserver(function () { draw(); }).observe(plot); else root.addEventListener('resize', function () { draw(); });
    if (cfg.tools && cfg.share) tools(cfg, function () { return view; });
    return { redraw: function () { draw(true); }, state: function () { return { view: view, hide: hide, range: cur.label }; } };
  }
  function tools(cfg, getView) {
    var T = cfg.tools, sh = cfg.share, nav = root.navigator || {}, canFiles = false, D = T.ownerDocument;
    try { canFiles = !!(nav.share && nav.canShare && root.File && nav.canShare({ files: [new root.File([''], 'x.png', { type: 'image/png' })] })); } catch (e) {}
    T.innerHTML = (nav.share ? '<button type="button" class="agc-btn agc-share">Share</button>' : '<button type="button" class="agc-btn agc-copy">Copy link</button>') +
      '<button type="button" class="agc-btn agc-save">Save the picture</button>';
    var save = function (b) { var a = D.createElement('a'); a.href = URL.createObjectURL(b); a.download = sh.file || 'agsist-chart.png'; D.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
    var flash = function (b, t) { var o = b.textContent; b.textContent = t; setTimeout(function () { b.textContent = o; }, 1800); };
    T.querySelector('.agc-save').addEventListener('click', function () { card(cfg, getView(), function (b) { if (b) { save(b); ga('picture_download', sh.file); } }); });
    var cp = T.querySelector('.agc-copy');
    if (cp) cp.addEventListener('click', function () { try { nav.clipboard.writeText(sh.url).then(function () { flash(cp, 'Link copied'); }, function () { flash(cp, sh.url); }); } catch (e) { flash(cp, sh.url); } });
    var sb = T.querySelector('.agc-share');
    if (sb) sb.addEventListener('click', function () {
      ga('share_open', sh.file);
      var v = getView(), st = cfg.story ? cfg.story(v) : {};
      card(cfg, v, function (b) {
        var data = { title: sh.title, text: st.head, url: sh.url };
        try { if (b && canFiles) data.files = [new root.File([b], sh.file || 'agsist-chart.png', { type: 'image/png' })]; } catch (e) {}
        nav.share(data).then(function () { ga('share_done', sh.file); }, function (e) { if (!(e && e.name === 'AbortError') && b) save(b); });
      });
    });
  }

  var api = { mount: mount, svg: svg, card: card, slice: slice, pairs: pairs, ranges: ranges, readout: readout, short: short, long: long, money: money };
  root.AgChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
