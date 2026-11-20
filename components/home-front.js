/* components/home-front.js: the front page on /index1 (Nov 20, 2026; fx/index1-bold, owner: "go bold on index1, i want to
   be blown away"). One live answer for the reader's place, then the world around it, one card per topic.

   THE ANSWER (#fp-hero), read at once.
   - Saved place (components/saved-place.js): the best corn and soybean bid within 50 miles from the elevator boards our
     network reads (dnilgis.github.io/bids data/merged-index.json, the file the home page and /cash-bids read): the cash
     price, its elevator and distance, its basis against the board's own futures month, and the change since the board's
     price on the trading day before it last posted (data/bids-prev/<ST>.json, the home page's own join). A bid older than
     four days is left out. Under them, one line: rain at the place in the last 24 hours (NOAA MRMS radar with gauges,
     data/radar-rain) and the futures move (data/prices.json, the price strip's file, with components/price-local.js's
     own rules for the change and the overnight trade).
   - No place: the same shape for farm country. Iowa's median corn basis and its week's move (data/basis-states.json),
     how many Corn Belt counties got a tenth of an inch of rain in the last 24 hours (data/radar-rain/county-<st>.json),
     and the futures line.
   - "updated 6:42 am": when the file behind the two big numbers was written, Central time. The dot turns green once
     they are in hand and pulses twice, never again.

   THE WORLD (#fp-world), read when it comes near the screen. Every card: the topic and the place, one number, one line
   on what it means, one small picture, a dated source and a tap to the full tool. In order: bids, rain, markets, the
   Friday Chart, land sales, fertilizer, ARC/PLC, funds. Soil (NCCPI, CSR2) joins once a county soil file exists; there
   is none yet, so there is no soil card, never an empty one. The Friday Chart card shows only when
   /infographic/latest.json names a chart from the last 13 days and the card's spot is below the screen.

   RULES
   - Each box holds its room from the markup and css/home-front.css; nothing written here changes a height.
   - A file that does not answer leaves that card's own "could not read" line, never an old number.
   - Motion: a number counts up once when it first shows, a line draws once; none with reduced motion. Nothing loops.
   - Colour carries meaning only: green up, red down (a basis that rises is stronger, so green).
   - The place never leaves the browser: every file read is a whole state, county set or the whole country.
   window.AgHomeFront (node: module.exports, test/home-front.test.mjs). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var NET = 'https://dnilgis.github.io/bids/data/merged-index.json';
  var RADIUS = 50, MAX_AGE_H = 96;
  var BELT = ['IA', 'IL', 'IN', 'OH', 'MN', 'NE', 'WI', 'MO', 'SD', 'KS', 'ND', 'MI'];
  var MINUS = '−';

  /* ------------------------------------------------------------------ pure helpers (tested in node) */
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ct(t) {
    var d = new Date(t);
    if (!isFinite(d.getTime())) return null;
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, wd: p.weekday };
    } catch (e) { return null; }
  }
  function isoOf(p) { return p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d; }
  function ctIso(t) { var p = ct(t); return p ? isoOf(p) : ''; }
  function hm(p) { var h = p.hh % 12 || 12; return h + ':' + (p.mm < 10 ? '0' : '') + p.mm + ' ' + (p.hh < 12 ? 'am' : 'pm'); }
  /* a moment in Central, as short as the day allows: "6:42 am" today, "Thu 9:10 pm" this week, "Nov 12" before */
  function when(t, now) {
    var p = ct(t), n = ct(now == null ? Date.now() : now);
    if (!p || !n) return '';
    var a = Date.UTC(p.y, p.m - 1, p.d), b = Date.UTC(n.y, n.m - 1, n.d), days = Math.round((b - a) / 864e5);
    if (days === 0) return hm(p);
    if (days > 0 && days < 6) return p.wd + ' ' + hm(p);
    return MON[p.m - 1] + ' ' + p.d;
  }
  function md(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function dayName(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? WD[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] : ''; }
  function comma(n) { return Math.round(n).toLocaleString('en-US'); }
  function money(v, dp) { var s = Math.abs(v).toFixed(dp || 0).split('.'); return (v < 0 ? MINUS : '') + '$' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (s[1] ? '.' + s[1] : ''); }
  /* the join key of data/bids-prev (scripts/build_bids_prev.py): FNV-1a over place|crop|period */
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function miles(a, b, c, d) {
    var R = 3958.8, r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    return R * 2 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
  }
  /* the elevator as the network names it (components/bids-network.js placeLabel): no name twice, no state twice */
  function placeLabel(p) {
    var city = String(p.town || p.city || '').trim(), st = String(p.state || '').trim(), op = String(p.operator || '').trim();
    if (city && op && city.toLowerCase() === op.toLowerCase()) city = '';
    var where = city ? (/,\s*[A-Za-z]{2}\s*$/.test(city) ? city : city + (st ? ', ' + st : '')) : st;
    return op && where ? op + ', ' + where : op || where;
  }
  /* the board's own futures month: "November '26 (2026-12)" -> "Dec" */
  function futMonth(delivery) { var m = /\((\d{4})-(\d{2})\)\s*$/.exec(String(delivery || '')); return m ? MON[+m[2] - 1] : ''; }
  function basisWords(c, mon) {
    if (!num(c)) return '';
    var a = Math.round(Math.abs(c) * 4) / 4, t = (a % 1 ? (a | 0 ? (a | 0) : '') + ['', '¼', '½', '¾'][Math.round((a % 1) * 4)] : String(a)) + '¢';
    if (a === 0) return 'even with ' + (mon || 'futures');
    return t + (c < 0 ? ' under ' : ' over ') + (mon || 'futures');
  }

  /* the bids within RADIUS miles of a point, per crop: {corn: {best, n, lo, hi, cash: [..]}, soybeans: ...}.
     A place counts when it posts in dollars, has a current-delivery bid (the index's `now`) and posted within MAX_AGE_H. */
  function nearBids(idx, lat, lon, now) {
    var out = { corn: null, soybeans: null, generated: idx && idx.generated || '' };
    if (!idx || !Array.isArray(idx.places) || !num(lat) || !num(lon)) return out;
    var t = now == null ? Date.now() : now;
    idx.places.forEach(function (p) {
      if (!p || !num(p.lat) || !num(p.lon) || (p.currency || 'USD') !== 'USD' || !p.now) return;
      var posted = Date.parse(p.pricedAt || p.checkedAt || '');
      if (!isFinite(posted) || t - posted > MAX_AGE_H * 36e5 || posted - t > 36e5) return;
      var d = miles(lat, lon, p.lat, p.lon);
      if (d > RADIUS) return;
      ['corn', 'soybeans'].forEach(function (c) {
        var n = p.now[c];
        if (!n || !num(n.cash) || n.cash <= 0) return;
        var row = { cash: n.cash, basis: num(n.basisCents) ? n.basisCents : num(n.basis) ? n.basis * 100 : null, mon: futMonth(n.delivery), d: d,
          name: placeLabel(p), posted: p.pricedAt || p.checkedAt, st: p.state, key: p.place && n.period ? fnv(p.place + '|' + c + '|' + n.period) : '' };
        var o = out[c] || (out[c] = { best: null, n: 0, lo: Infinity, hi: -Infinity, cash: [] });
        o.n++; o.cash.push(n.cash);
        if (n.cash < o.lo) o.lo = n.cash;
        if (n.cash > o.hi) o.hi = n.cash;
        if (!o.best || n.cash > o.best.cash || (n.cash === o.best.cash && d < o.best.d)) o.best = row;
      });
    });
    return out;
  }
  /* the change since the board's last price on an earlier trading day: {c (cents), since (ISO)} or null */
  function moveSince(prev, row, now) {
    var hist = prev && prev.rows && row && row.key ? prev.rows[row.key] : null, on = row && row.posted ? ctIso(row.posted) : '';
    if (!Array.isArray(hist) || !on) return null;
    var p = null;
    hist.forEach(function (h) { if (h && h[0] < on && num(h[1])) p = h; });
    if (!p) return null;
    return { c: Math.round((row.cash - p[1]) * 400) / 4, since: p[0] };
  }
  function moveText(m) {
    if (!m) return { t: '', c: 'nc' };
    var a = Math.abs(m.c), w = dayName(m.since);
    if (a < 0.125) return { t: 'Unchanged since ' + w, c: 'nc' };
    var cents = basisWords(a, '').replace(/ over futures$/, '');
    return { t: (m.c > 0 ? '▲ ' : '▼ ') + cents + ' since ' + w, c: m.c > 0 ? 'up' : 'dn' };
  }
  /* a state's network basis for a crop: {cents, wow (cents), n, co, mon, gen} or null */
  function stateBasis(B, st, crop) {
    var s = B && B.states && B.states[st], c = s && s.crops && s.crops[crop];
    if (!c || !num(c.median) || !(c.n >= ((B && B.min_n) || 3))) return null;
    return { cents: Math.round(c.median * 100), wow: num(c.wow) ? Math.round(c.wow * 100) : null, n: c.n, co: c.companies || null,
      mon: String(c.label || '').split(' ')[0], lo: num(c.lo) ? Math.round(c.lo * 100) : null, hi: num(c.hi) ? Math.round(c.hi * 100) : null,
      name: s.name || st, gen: B.generated || '', usda: c.usda || null };
  }
  /* Corn Belt county rain counts from the county files: window 0 = 24 hours, 1 = 7 days */
  function beltRain(files, w) {
    var out = { n: 0, of: 0, states: [], end: '' };
    (files || []).forEach(function (f) {
      if (!f || !f.counties) return;
      var n = 0, of = 0;
      Object.keys(f.counties).forEach(function (k) { var v = f.counties[k]; if (!v || !num(v[w])) return; of++; if (v[w] >= 10) n++; });
      if (!of) return;
      out.n += n; out.of += of; out.states.push({ st: f.st, share: n / of });
      if (!out.end || String(f.data_end) < out.end) out.end = String(f.data_end || '');
    });
    return out.of ? out : null;
  }
  /* the futures line: the overnight move in the overnight hours, else the day's change, from the price strip's file */
  function futItems(P, PX, now) {
    if (!P || !P.quotes || !PX) return null;
    var t = now == null ? Date.now() : now, Q = PX.roll(P.quotes, new Date(t)), nb = P.nearby || {}, out = [], stamp = '', ovn = PX.ovnWindow(new Date(t));
    [['corn', 'corn'], ['beans', 'beans']].forEach(function (a) {
      var key = nb[a[0]] && nb[a[0]].key, q = (key && Q[key]) || Q[a[1]];
      if (!q || !num(q.close)) return;
      var name = (PX.label(q.ticker) || '').split(' ')[0] + ' ' + (a[0] === 'corn' ? 'corn' : 'beans');
      var o = ovn ? PX.overnight(q) : null, net = null;
      if (o && num(o.net)) { net = o.net; if (!stamp) stamp = 'overnight, ' + when(o.at, t); }
      else { var ch = PX.change(q, key); net = ch ? ch.net : null; if (!stamp) stamp = PX.shortStamp(q, P.fetched, new Date(t)); }
      out.push({ name: name, px: q.close, net: net, ovn: !!(o && num(o.net)) });
    });
    return out.length ? { items: out, stamp: stamp } : null;
  }
  /* the fertilizer card: one product from the state report's history (data/fertilizer-ams-history.json) */
  function fertSeries(H, key) {
    var r = (H && H.reports || []).filter(function (x) { return x && x.avg && num(x.avg[key]) && /^\d{4}-\d{2}-\d{2}$/.test(x.date || ''); });
    return r.map(function (x) { return { d: x.date, v: x.avg[key] }; });
  }
  /* the Daily's date, written "Friday, November 20, 2026" (or ISO) -> "2026-11-20" */
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function dailyIso(s) {
    var t = String(s || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    var m = /([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(t), i = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
    return i < 0 ? '' : m[3] + '-' + (i < 9 ? '0' : '') + (i + 1) + '-' + (+m[2] < 10 ? '0' : '') + (+m[2]);
  }
  /* COT: a market's managed money net and the week's change */
  function fundLine(C, k) {
    var x = C && C[k];
    if (!x || !num(x.net) || !num(x.prev)) return null;
    var side = x.side === 'flat' ? 'about even' : x.net > 0 ? 'net long' : 'net short';
    return { net: x.net, chg: x.net - x.prev, side: side };
  }

  /* ------------------------------------------------------------------ small pictures (inline SVG, 52 px tall) */
  var W = 320, H = 52;
  function spark(vals, opt) {
    opt = opt || {};
    var lo = Math.min.apply(null, vals.concat(opt.zero ? [0] : [])), hi = Math.max.apply(null, vals.concat(opt.zero ? [0] : [])), span = hi - lo || 1, n = vals.length;
    var top = 6, bot = opt.labels ? 36 : 46;
    var y = function (v) { return bot - (v - lo) / span * (bot - top); };
    var pts = vals.map(function (v, i) { return [n > 1 ? 4 + i * (W - 8) / (n - 1) : W / 2, y(v)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
    var e = pts[n - 1], h = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.label || '') + '">';
    if (opt.zero && lo < 0 && hi > 0) h += '<line class="fp-g-zero" x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"></line>';
    h += '<path class="fp-g-area" d="' + d + 'L' + e[0].toFixed(1) + ' ' + bot + 'L' + pts[0][0].toFixed(1) + ' ' + bot + 'Z"></path>';
    h += '<path class="fp-g-line" d="' + d + '" vector-effect="non-scaling-stroke"></path>';
    h += '<circle class="fp-g-end" cx="' + e[0].toFixed(1) + '" cy="' + e[1].toFixed(1) + '" r="3.5" vector-effect="non-scaling-stroke"></circle>';
    if (opt.labels) h += '<text class="fp-g-t" x="2" y="50">' + esc(opt.labels[0]) + '</text><text class="fp-g-t" x="' + (W - 2) + '" y="50" text-anchor="end">' + esc(opt.labels[1]) + '</text>';
    return h + '</svg>';
  }
  /* bars: [{k, v (0..1), me}] with each label under its bar */
  function bars(items, label) {
    var n = items.length, gap = n > 6 ? 5 : 10, bw = (W - gap * (n - 1)) / n, h = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
    items.forEach(function (it, i) {
      var x = i * (bw + gap), bh = Math.max(2, Math.round(it.v * 34));
      h += '<rect class="fp-g-bar' + (it.me ? ' is-me' : '') + '" x="' + x.toFixed(1) + '" y="' + (36 - bh) + '" width="' + bw.toFixed(1) + '" height="' + bh + '" rx="2"></rect>' +
        '<text class="fp-g-t' + (it.me ? ' is-me' : '') + '" x="' + (x + bw / 2).toFixed(1) + '" y="50" text-anchor="middle">' + esc(it.k) + '</text>';
    });
    return h + '</svg>';
  }
  /* a strip: every value as a dot on one line, the reader's own (or the best) marked, the ends named */
  function strip(vals, mark, ends, label) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 1;
    var x = function (v) { return 8 + (v - lo) / span * (W - 16); };
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '"><line class="fp-g-zero" x1="0" x2="' + W + '" y1="20" y2="20"></line>';
    vals.forEach(function (v) { h += '<circle class="fp-g-pt" cx="' + x(v).toFixed(1) + '" cy="20" r="4.5"></circle>'; });
    if (num(mark)) h += '<circle class="fp-g-pt is-me" cx="' + x(mark).toFixed(1) + '" cy="20" r="6.5"></circle>';
    return h + '<text class="fp-g-t" x="2" y="48">' + esc(ends[0]) + '</text><text class="fp-g-t is-me" x="' + (W - 2) + '" y="48" text-anchor="end">' + esc(ends[1]) + '</text></svg>';
  }
  /* ranges: [{k, lo, hi, med, me}] on one scale, a state's low to high with its middle as a dot */
  function ranges(items, label) {
    var lo = Math.min.apply(null, items.map(function (r) { return r.lo; })), hi = Math.max.apply(null, items.map(function (r) { return r.hi; })), span = hi - lo || 1;
    var n = items.length, cw = W / n, y = function (v) { return 34 - (v - lo) / span * 30; };
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
    items.forEach(function (r, i) {
      var cx = (i + 0.5) * cw;
      h += '<line class="fp-g-rng" x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + y(r.lo).toFixed(1) + '" y2="' + y(r.hi).toFixed(1) + '"></line>' +
        '<circle class="fp-g-med" cx="' + cx.toFixed(1) + '" cy="' + y(r.med).toFixed(1) + '" r="' + (r.me ? 5 : 3.5) + '"></circle>' +
        '<text class="fp-g-t' + (r.me ? ' is-me' : '') + '" x="' + cx.toFixed(1) + '" y="50" text-anchor="middle">' + esc(r.k) + '</text>';
    });
    return h + '</svg>';
  }

  var api = { ct: ct, ctIso: ctIso, when: when, md: md, dayName: dayName, fnv: fnv, miles: miles, placeLabel: placeLabel, futMonth: futMonth,
    basisWords: basisWords, nearBids: nearBids, moveSince: moveSince, moveText: moveText, stateBasis: stateBasis, beltRain: beltRain,
    futItems: futItems, fertSeries: fertSeries, fundLine: fundLine, dailyIso: dailyIso, spark: spark, bars: bars, strip: strip, ranges: ranges, BELT: BELT, RADIUS: RADIUS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.AgHomeFront = api;

  /* ------------------------------------------------------------------ the page */
  var d = root.document, hero = d.getElementById('fp-hero');
  if (!hero) return;
  var still = false;
  try { still = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function $(id) { return d.getElementById(id); }
  function get(u) { return root.AG && root.AG.json ? root.AG.json(u) : root.fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function text(u) { return root.AG && root.AG.text ? root.AG.text(u) : root.fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }); }
  function px(dollars) { var P = root.AG && root.AG.px; return P ? P.priceDollars(dollars, { fracClass: 'fp-fr' }) : esc('$' + dollars.toFixed(2)); }
  function mv(cents) { var P = root.AG && root.AG.px; return P ? P.move(cents, { sign: true }) : (cents > 0 ? '+' : '') + cents + '¢'; }
  function load(src, name) {
    if (root[name]) return Promise.resolve(root[name]);
    return new Promise(function (ok, no) {
      var s = d.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { root[name] ? ok(root[name]) : no(new Error('no ' + name)); };
      s.onerror = function () { no(new Error('no ' + name)); };
      d.head.appendChild(s);
    });
  }
  var once = {};
  function memo(k, f) { return once[k] || (once[k] = f().catch(function (e) { delete once[k]; throw e; })); }

  /* the number counts up once, the first time it is on screen; its width is held so nothing beside it moves */
  var seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { seen.unobserve(e.target); if (e.target._fpRun) e.target._fpRun(); } });
  }, { threshold: 0.5 }) : null;
  function tick(node, n, fmt) {
    if (still || !seen || !node || !num(n) || n <= 0 || !root.requestAnimationFrame) return;
    var end = node.innerHTML;
    node.style.display = 'inline-block'; node.style.width = Math.ceil(node.getBoundingClientRect().width) + 'px';
    node._fpRun = function () {
      var t0 = 0;
      function step(t) {
        if (!t0) t0 = t;
        var q = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - q, 3);
        if (q < 1) { node.textContent = fmt(n * e); root.requestAnimationFrame(step); } else node.innerHTML = end;
      }
      root.requestAnimationFrame(step);
    };
    seen.observe(node);
  }
  function draw(box) {
    if (still || !seen) return;
    var p = box.querySelector('.fp-g-line');
    if (!p || !p.getTotalLength) return;
    var svg = p.ownerSVGElement;
    svg.style.setProperty('--len', String(Math.ceil(p.getTotalLength())));
    svg._fpRun = function () { svg.classList.add('fp-draw'); };
    seen.observe(svg);
  }

  /* ---------------- the place */
  function place() {
    var A = root.AgSavedPlace;
    if (!A || !A.read || !A.read()) return Promise.resolve(null);
    return Promise.resolve(A.full ? A.full() : A.read()).then(function (p) {
      if (!p || !p.zip) return null;
      var raw = ''; try { raw = String((JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null') || {}).county || ''); } catch (e) {}
      p.countyRaw = raw && A.county && A.county(raw) === p.county ? raw : p.county;
      return p;
    }).catch(function () { return null; });
  }
  function nearName(p) { var t = p && p.town; return t ? t : p && p.zip ? p.zip : ''; }

  /* ---------------- shared reads */
  function bidsAt(p) {
    return memo('net', function () { return get(NET); }).then(function (idx) {
      var b = nearBids(idx, p.lat, p.lon, Date.now());
      var sts = {};
      ['corn', 'soybeans'].forEach(function (c) { if (b[c] && b[c].best && b[c].best.st) sts[b[c].best.st] = 1; });
      return Promise.all(Object.keys(sts).map(function (s) { return get('/data/bids-prev/' + s + '.json').then(function (j) { return [s, j]; }, function () { return [s, null]; }); }))
        .then(function (list) { var by = {}; list.forEach(function (x) { by[x[0]] = x[1]; }); b.prev = by; return b; });
    });
  }
  function rainAt(p) {
    return memo('rain:' + p.lat + ',' + p.lon, function () {
      return Promise.all([get('/data/radar-rain/index.json'), load('/components/radar-rain.js?v=1', 'AgRadarRain')]).then(function (a) {
        var idx = a[0], R = a[1], st = R.pickState(idx, p.lat, p.lon);
        if (!st) throw new Error('outside');
        return root.fetch('/data/radar-rain/' + st.toLowerCase() + '.bin').then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(R.parse).then(function (f) {
          var w = ['24h', '3d', '7d', 'month'].map(function (k) { return R.lookup(f.header, f.grids[k], p.lat, p.lon); });
          if (w[0] == null) throw new Error('no data');
          return { w: w, end: idx.data_end, monthStart: idx.windows && idx.windows.month && idx.windows.month.start };
        });
      });
    });
  }
  function belt() {
    return memo('belt', function () {
      return Promise.all(BELT.map(function (s) { return get('/data/radar-rain/county-' + s.toLowerCase() + '.json').catch(function () { return null; }); })).then(function (fs) {
        if (!fs.some(Boolean)) throw new Error('none');
        return fs;
      });
    });
  }
  function prices() { return memo('px', function () { return get('/data/prices.json'); }); }

  /* ---------------- the answer */
  function tile(i, o) {
    var v = $('fp-t' + i + '-v');
    v.innerHTML = '<span class="fp-n">' + o.v + '</span>' + (o.u ? '<span class="fp-u">' + esc(o.u) + '</span>' : '');
    var m = $('fp-t' + i + '-m'); m.textContent = o.m || ''; m.className = 'fp-m ' + (o.mc || '');
    $('fp-t' + i + '-w').innerHTML = o.w || '';
    if (o.href) $('fp-t' + i).setAttribute('href', o.href);
    if (o.n != null) tick(v.firstChild, o.n, o.f);
  }
  function tileFail(i, words) {
    $('fp-t' + i + '-v').innerHTML = '<span class="fp-none">No reading</span>';
    $('fp-t' + i + '-m').textContent = '';
    $('fp-t' + i + '-w').textContent = words;
  }
  function stamp(t, label) {
    var u = $('fp-upd'), l = $('fp-live');
    if (!t) { u.textContent = label || 'Could not read this morning’s files'; return; }
    u.textContent = 'Live · updated ' + when(t);
    l.classList.add('is-live');
    if (!l.classList.contains('was-new')) { l.classList.add('is-new', 'was-new'); }
  }
  function bidTile(i, c, crop, p) {
    var o = c && c[crop];
    if (!o || !o.best) { tileFail(i, 'No elevator on our network posts a ' + (crop === 'corn' ? 'corn' : 'soybean') + ' bid within 50 mi of ' + nearName(p) + '.'); return; }
    var b = o.best, m = moveText(moveSince(c.prev && c.prev[b.st], b));
    tile(i, { v: px(b.cash), m: m.t, mc: m.c, n: b.cash, f: function (x) { return '$' + x.toFixed(2); },
      w: '<b class="fp-w1">' + esc(b.name) + '</b><span class="fp-w1">' + Math.round(b.d) + ' mi · ' + esc(basisWords(b.basis, b.mon)) + '</span>', href: '/cash-bids' });
  }
  function line(items) { $('fp-line').innerHTML = items.filter(Boolean).map(function (s) { return '<span class="fp-li">' + s + '</span>'; }).join(''); }
  function futHtml(F) {
    if (!F) return ['Futures: could not read the price file just now'];
    var a = F.items.map(function (x) {
      var c = num(x.net) ? '<span class="' + (x.net > 0 ? 'up' : x.net < 0 ? 'dn' : 'nc') + '">' + esc(x.net === 0 ? 'unch' : mv(x.net)) + '</span>' : '';
      return esc(x.name) + ' ' + (x.ovn ? c : '<b>' + px(x.px / 100) + '</b> ' + c);
    });
    a[0] = (F.items[0].ovn ? 'Overnight ' : '') + a[0];
    return a.concat(F.stamp ? ['<small>' + esc(F.stamp.replace(/^Read /, '').replace(/ CT\b/, '')) + '</small>'] : []);
  }
  function answerSaved(p) {
    var PX = root.AgPxStamp;
    bidsAt(p).then(function (b) {
      bidTile(1, b, 'corn', p); bidTile(2, b, 'soybeans', p);
      stamp(b.generated);
    }).catch(function () {
      tileFail(1, 'Could not read the elevator bids just now.'); tileFail(2, 'Could not read the elevator bids just now.'); stamp(null);
    });
    var r = rainAt(p).then(function (x) { return 'Rain since yesterday <b>' + (x.w[0] / 100).toFixed(2) + ' in</b>'; }, function () { return 'Rain: could not read the radar file'; });
    var f = prices().then(function (P) { return futHtml(futItems(P, PX)); }, function () { return futHtml(null); });
    Promise.all([r, f]).then(function (a) { line([a[0]].concat(a[1])); });
  }
  function answerFresh() {
    var PX = root.AgPxStamp;
    get('/data/basis-states.json').then(function (B) {
      var s = stateBasis(B, 'IA', 'corn');
      if (!s) throw new Error('none');
      var w = s.wow == null ? { t: '', c: 'nc' } : Math.abs(s.wow) < 0.5 ? { t: 'Flat on the week', c: 'nc' } :
        { t: (s.wow > 0 ? '▲ ' : '▼ ') + Math.abs(s.wow) + '¢ on the week', c: s.wow > 0 ? 'up' : 'dn' };
      tile(1, { v: esc(String(Math.abs(s.cents))) + '¢', u: (s.cents < 0 ? 'under ' : 'over ') + s.mon, m: w.t, mc: w.c, n: Math.abs(s.cents), f: function (x) { return Math.round(x) + '¢'; },
        w: 'Middle of <b>' + comma(s.n) + '</b> Iowa elevators’ bids, cash minus futures.', href: '/basis' });
      stamp(s.gen);
    }).catch(function () { tileFail(1, 'Could not read the basis file just now.'); stamp(null); });
    belt().then(function (fs) {
      var b = beltRain(fs, 0);
      if (!b) throw new Error('none');
      tile(2, { v: comma(b.n), u: b.n === 1 ? 'county' : 'counties', m: 'had 0.10 in or more', mc: 'nc', n: b.n, f: comma,
        w: 'Of <b>' + comma(b.of) + '</b> Corn Belt counties, in the 24 hours to ' + esc(when(b.end)) + '.', href: '/rain' });
    }).catch(function () { tileFail(2, 'Could not read the radar file just now.'); });
    prices().then(function (P) { line(futHtml(futItems(P, PX))); }, function () { line(futHtml(null)); });
  }

  /* ---------------- the world */
  function card(id, o) {
    var box = $('fp-c-' + id);
    if (!box) return;
    if (o.k) $('fp-c-' + id + '-k').innerHTML = o.k;
    var v = $('fp-c-' + id + '-v');
    v.innerHTML = '<span class="fp-n">' + o.v + '</span>' + (o.u ? '<span class="fp-u">' + esc(o.u) + '</span>' : '');
    $('fp-c-' + id + '-s').innerHTML = o.s || '';
    $('fp-c-' + id + '-g').innerHTML = o.g || '';
    $('fp-c-' + id + '-src').textContent = o.src || '';
    if (o.href) box.setAttribute('href', o.href);
    box.classList.remove('is-off');
    if (o.n != null) tick(v.firstChild, o.n, o.f);
    draw(box);
  }
  function cardFail(id, words) {
    var box = $('fp-c-' + id);
    if (!box) return;
    box.classList.add('is-off');
    $('fp-c-' + id + '-v').textContent = 'Could not read';
    $('fp-c-' + id + '-s').textContent = words;
    $('fp-c-' + id + '-g').innerHTML = '';
  }
  /* the picture box's own width, so a picture is drawn at its size and its words are never stretched */
  function gw(id) { var g = $('fp-c-' + id + '-g'); var w = g ? Math.round(g.getBoundingClientRect().width) : 0; return w > 120 ? w : 320; }
  var placeK = function (topic, p) { return esc(topic) + (p ? ' · <b>' + esc(nearName(p)) + '</b>' : ''); };

  function bidsCard(p) {
    if (p && p.lat != null) {
      return bidsAt(p).then(function (b) {
        var c = b.corn;
        if (!c || !c.best) { cardFail('bids', 'No elevator on our network posts a corn bid within 50 mi of ' + nearName(p) + '.'); return; }
        var cents = Math.round((c.hi - c.lo) * 100);
        W = gw('bids');
        card('bids', { k: placeK('Corn bids, 50 mi', p), v: comma(c.n), u: c.n === 1 ? 'elevator' : 'elevators', n: c.n, f: comma,
          s: 'Bids run <b>' + px(c.lo) + '</b> to <b>' + px(c.hi) + '</b>. ' + (cents > 0 ? 'Shopping around is worth up to ' + cents + '¢ a bushel.' : 'Every elevator posts the same.'),
          g: strip(c.cash, c.hi, [px(c.lo).replace(/<[^>]+>/g, '') + ' low', 'best ' + px(c.hi).replace(/<[^>]+>/g, '')], 'Each corn bid within 50 miles'),
          src: 'Elevator boards, read ' + when(b.generated), a: 'Every bid near you', href: '/cash-bids' });
      }).catch(function () { cardFail('bids', 'Could not read the elevator bids just now.'); });
    }
    return get('/data/basis-states.json').then(function (B) {
      var pick = ['IA', 'IL', 'IN', 'OH', 'MN', 'NE', 'SD', 'KS', 'MO', 'WI'], rs = [];
      pick.forEach(function (st) { var s = stateBasis(B, st, 'soybeans'); if (s && s.lo != null && s.hi != null) rs.push({ k: st, lo: s.lo, hi: s.hi, med: s.cents, me: st === 'IA', s: s }); });
      var ia = rs.filter(function (r) { return r.me; })[0];
      if (!ia) throw new Error('none');
      W = gw('bids');
      card('bids', { k: 'Soybean basis · <b>Corn Belt</b>', v: Math.abs(ia.med) + '¢', u: (ia.med < 0 ? 'under ' : 'over ') + ia.s.mon + ', Iowa', n: Math.abs(ia.med), f: function (x) { return Math.round(x) + '¢'; },
        s: 'The middle Iowa soybean bid, ' + comma(ia.s.n) + ' elevators. Each line is a state, low bid to high, the dot its middle.',
        g: ranges(rs, 'Soybean basis by state, low to high, with the middle'), src: 'Elevator boards, ' + md(ctIso(B.generated)), a: 'Basis by state', href: '/basis' });
    }).catch(function () { cardFail('bids', 'Could not read the basis file just now.'); });
  }
  function rainCard(p) {
    if (p && p.lat != null) {
      return rainAt(p).then(function (x) {
        var w = x.w, top = Math.max.apply(null, w.map(function (v) { return v || 0; })) || 1, ms = x.monthStart ? ctIso(x.monthStart) : '';
        var mo = ms ? MON[+ms.slice(5, 7) - 1] : 'Month';
        W = gw('rain');
        card('rain', { k: placeK('Rain', p), v: (w[3] == null ? '' : (w[3] / 100).toFixed(2)), u: 'in since ' + (ms ? md(ms) : 'the 1st'), n: w[3] != null ? w[3] / 100 : null, f: function (v) { return v.toFixed(2); },
          s: '<b>' + (w[0] / 100).toFixed(2) + ' in</b> in the last 24 hours, <b>' + (w[2] == null ? 'no reading' : (w[2] / 100).toFixed(2) + ' in') + '</b> over 7 days.',
          g: bars([{ k: '24 h', v: (w[0] || 0) / top }, { k: '3 days', v: (w[1] || 0) / top }, { k: '7 days', v: (w[2] || 0) / top }, { k: mo, v: (w[3] || 0) / top, me: true }], 'Rain at this place by window'),
          src: 'NOAA radar with gauges, to ' + when(x.end), a: 'Rain at your fields', href: '/field-rain' });
      }).catch(function () { cardFail('rain', 'Could not read the radar file just now.'); });
    }
    return belt().then(function (fs) {
      var b = beltRain(fs, 1);
      if (!b) throw new Error('none');
      b.states.sort(function (x, y) { return BELT.indexOf(x.st) - BELT.indexOf(y.st); });
      W = gw('rain');
      card('rain', { k: 'Rain · <b>12 Corn Belt states</b>', v: comma(b.n), u: b.n === 1 ? 'county' : 'counties', n: b.n, f: comma,
        s: 'got a tenth of an inch or more in the last 7 days, of <b>' + comma(b.of) + '</b>. Each bar: a state’s share.',
        g: bars(b.states.map(function (s) { return { k: s.st, v: s.share / Math.max(0.25, Math.max.apply(null, b.states.map(function (x) { return x.share; }))) }; }), 'Share of each state’s counties with a tenth of an inch in 7 days'),
        src: 'NOAA radar with gauges, to ' + when(b.end), a: 'Rain map', href: '/rain#radar' });
    }).catch(function () { cardFail('rain', 'Could not read the radar file just now.'); });
  }
  function mktCard() {
    var PX = root.AgPxStamp;
    return Promise.all([prices(), get('/data/price-stats.json').catch(function () { return null; })]).then(function (a) {
      var P = a[0], S = a[1], F = futItems(P, PX);
      if (!F) throw new Error('none');
      var c = F.items[0], s = F.items[1], cs = S && S.corn;
      var hist = cs && Array.isArray(cs.hist) ? cs.hist.slice(-52).filter(num) : [];
      var chg = num(c.net) ? ' <span class="' + (c.net > 0 ? 'up' : c.net < 0 ? 'dn' : 'nc') + '">' + esc(c.net === 0 ? 'unch' : mv(c.net)) + '</span>' : '';
      W = gw('mkt');
      card('mkt', { k: esc(c.name.replace(' corn', '')) + ' corn · <b>CBOT</b>', v: px(c.px / 100), n: c.px / 100, f: function (x) { return '$' + x.toFixed(2); },
        s: (chg ? chg.slice(1) + (c.ovn ? ' overnight. ' : ' on the day. ') : '') + (num(cs && cs.pct) ? 'Below <b>' + (100 - cs.pct) + '%</b> of weekly closes in 5 years.' : '') + (s ? ' ' + esc(s.name) + ' <b>' + px(s.px / 100) + '</b>.' : ''),
        g: hist.length > 4 ? spark(hist, { label: 'Corn futures, the last 52 weekly closes', labels: ['52 weeks ago', 'now'] }) : '',
        src: 'Futures, ' + F.stamp, a: 'Futures', href: '/corn-futures-prices' });
    }).catch(function () { cardFail('mkt', 'Could not read the price file just now.'); });
  }
  function fcCard() {
    var F = root.AgHomeFridayChart, box = $('fp-c-fc');
    return get('/infographic/latest.json').then(function (lt) {
      var c = F && F.pick ? F.pick(lt, F.chicagoToday()) : null;
      if (!c || !box) return;
      /* shown only while its spot is below the screen, so showing it moves nothing the reader sees */
      var next = $('fp-c-mkt'), top = next ? next.getBoundingClientRect().bottom : 0;
      if (top < root.innerHeight) return;
      $('fp-c-fc-img').src = c.img; $('fp-c-fc-img').alt = c.alt;
      $('fp-c-fc-k').innerHTML = 'Friday Chart · <b>' + esc(c.shown.replace(/, \d{4}$/, '')) + '</b>';
      $('fp-c-fc-s').textContent = c.title; $('fp-c-fc-src').textContent = 'AGSIST, ' + c.shown;
      box.setAttribute('href', c.href); box.hidden = false; even();
    }).catch(function () {});
  }
  function landCard(p) {
    var L = root.AgHomeLand;
    return get('/data/land-sales/lead.json').then(function (j) {
      var pk = L && L.pick(j, p && p.state || '', new Date());
      if (!pk) throw new Error('none');
      var w = L.words(j, pk), r = pk.lead, name = w.k.match(/in ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/), top = Math.max(r.ppa, r.med || 0) || 1;
      var where = pk.mine && !pk.covered ? 'Not in ' + pk.mine + ' yet · <b>' + esc(pk.st) + '</b>' : '<b>' + esc(name ? name[1] : pk.st) + '</b>';
      W = gw('land');
      card('land', { k: 'Land sale · ' + where, v: money(r.ppa), u: 'an acre', n: r.ppa, f: function (x) { return money(x); },
        s: esc(w.s.split('.').slice(0, 2).join('.') + '.'),
        g: r.med ? bars([{ k: 'This sale', v: r.ppa / top, me: true }, { k: 'County middle ' + money(r.med), v: r.med / top }], 'This sale against the county middle') : '',
        src: (r.src || 'County records') + ', ' + md(r.when), a: 'Farm sales', href: w.href });
    }).catch(function () { cardFail('land', 'Could not read the farm sales file just now.'); });
  }
  function fertCard() {
    return Promise.all([get('/data/fertilizer-ams.json'), get('/data/fertilizer-ams-history.json').catch(function () { return null; })]).then(function (a) {
      var R = a[0], prod = (R.products || []).filter(function (x) { return x.key === 'anhydrous' && num(x.avg); })[0];
      if (!prod) throw new Error('none');
      var s = fertSeries(a[1], 'anhydrous'), first = s[0], urea = (R.products || []).filter(function (x) { return x.key === 'urea' && num(x.avg); })[0];
      var dv = first && first.d < R.report_date ? Math.round(prod.avg - first.v) : null;
      var mvw = dv == null ? '' : dv === 0 ? 'Unchanged since ' + md(first.d) + '.' : '<span class="' + (dv > 0 ? 'up' : 'dn') + '">' + (dv > 0 ? 'Up ' : 'Down ') + money(Math.abs(dv)) + '</span> since ' + md(first.d) + '.';
      var st = (/USDA AMS (\w+(?: \w+)?) Production/.exec(R.source || '') || [])[1] || 'State';
      W = gw('fert');
      card('fert', { k: 'Anhydrous · <b>' + esc(st) + ' report</b>', v: money(prod.avg), u: 'a ton', n: prod.avg, f: function (x) { return money(x); },
        s: 'Dealers’ average, ' + esc(st) + '. ' + mvw + (urea ? ' Urea ' + money(urea.avg) + '.' : ''),
        g: s.length > 1 ? spark(s.map(function (x) { return x.v; }), { label: 'Anhydrous ammonia, the state report’s average by report', labels: [md(s[0].d), md(s[s.length - 1].d)] }) : '',
        src: 'USDA AMS, ' + md(R.report_date), a: 'Fertilizer prices', href: '/fertilizer' });
    }).catch(function () { cardFail('fert', 'Could not read the USDA fertilizer report file just now.'); });
  }
  function arcCard(p) {
    var Wd = root.AgHomeWorld;
    if (!Wd) { cardFail('arc', 'Could not read the ARC/PLC file just now.'); return Promise.resolve(); }
    var href = p && p.state && p.countyRaw ? Wd.arcHref(p.state, p.countyRaw) : '';
    var county = href ? text(href).then(function (html) {
      var r = Wd.arcFromPage(html);
      if (!r) throw new Error('none');
      var top = Math.max(r.arc || 0, r.plc || 0) || 1, nm = Wd.countyName(p.state, p.countyRaw);
      W = gw('arc');
      card('arc', { k: 'ARC/PLC · <b>' + esc(nm) + '</b>', v: money(r.v, 2), u: 'a base acre', n: r.v, f: function (x) { return money(x, 2); },
        s: '2025 ' + esc(r.crop.toLowerCase()) + ', ' + r.prog + ' pays more here, before the 5.7% cut.',
        g: bars([{ k: 'ARC-CO ' + (r.arc == null ? 'none' : money(r.arc, 2)), v: (r.arc || 0) / top, me: r.prog === 'ARC-CO' }, { k: 'PLC ' + (r.plc == null ? 'none' : money(r.plc, 2)), v: (r.plc || 0) / top, me: r.prog === 'PLC' }], 'ARC-CO and PLC per base acre'),
        src: 'FSA data, ' + md(r.date), a: 'Your county’s check', href: href + '#your-check' });
    }) : Promise.reject(new Error('no county'));
    return county.catch(function () {
      return get('/data/arc-plc.json').then(function (j) {
        var r = Wd.arcNational(j);
        if (!r) throw new Error('none');
        var top = Math.max(r.v, r.usda || 0) || 1;
        W = gw('arc');
        card('arc', { k: 'ARC/PLC · <b>corn price floor</b>', v: money(r.v, 2), u: 'a bushel', n: r.v, f: function (x) { return money(x, 2); },
          s: 'Corn PLC pays if the 2026/27 season price ends below this.' + (r.usda != null ? ' USDA projects <b>' + money(r.usda, 2) + '</b>.' : ''),
          g: bars([{ k: 'PLC line ' + money(r.v, 2), v: r.v / top, me: true }].concat(r.usda != null ? [{ k: 'USDA ' + money(r.usda, 2), v: r.usda / top }] : []), 'Corn effective reference price and USDA projection'),
          src: 'FSA, USDA' + (r.usdaDate ? ' ' + r.usdaDate.replace(/, \d{4}$/, '') : ''), a: 'County check', href: '/arc-plc' });
      });
    }).catch(function () { cardFail('arc', 'Could not read the ARC/PLC file just now.'); });
  }
  function cotCard() {
    return Promise.all([get('/data/cot.json'), get('/data/cot-history.json').catch(function () { return null; })]).then(function (a) {
      var C = a[0], s = fundLine(C, 'beans'), c = fundLine(C, 'corn');
      if (!s) throw new Error('none');
      var hist = (a[1] && a[1].history && a[1].history.beans || []).slice(-52).map(function (x) { return x.net; }).filter(num);
      var ch = s.chg, rel = String(C.release_date || '');
      W = gw('cot');
      card('cot', { k: 'Funds · <b>soybeans</b>', v: comma(Math.abs(s.net)), u: s.net >= 0 ? 'net long' : 'net short', n: Math.abs(s.net), f: comma,
        s: 'Funds ' + (ch < 0 ? '<span class="dn">sold ' + comma(-ch) + '</span>' : '<span class="up">bought ' + comma(ch) + '</span>') + ' contracts in the week.' +
          (c ? ' Corn: ' + c.side + (c.side === 'about even' ? '' : ', ' + comma(Math.abs(c.net))) + '.' : ''),
        g: hist.length > 4 ? spark(hist, { zero: true, label: 'Managed money net position in soybeans, the last 52 weeks', labels: ['52 weeks ago', 'now'] }) : '',
        src: 'CFTC, positions ' + String(C.report_date || '').replace(/, \d{4}$/, '').replace(/^(\w{3})\w*/, '$1') + (rel ? ', out ' + md(rel) : ''), a: 'Fund positions', href: '/cot' });
    }).catch(function () { cardFail('cot', 'Could not read the COT file just now.'); });
  }
  function daily() {
    get('/data/daily.json').then(function (j) {
      var iso = dailyIso(j && j.date);
      if (!j || !j.headline || !iso) return;
      $('fp-dk').textContent = 'The AGSIST Daily · ' + dayName(iso) + ' ' + md(iso);
      $('fp-dt').textContent = j.headline;
    }).catch(function () {});
  }

  /* ---------------- set your place */
  var form = $('fp-zip'), btn = $('fp-set');
  btn.addEventListener('click', function () {
    var open = form.hidden;
    form.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) { try { $('fp-zip-in').focus(); } catch (e) {} }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var z = String($('fp-zip-in').value || '').trim(), msg = $('fp-zip-msg'), A = root.AgSavedPlace;
    if (!/^\d{5}$/.test(z) || !A) { msg.textContent = 'Type a five-digit ZIP code.'; return; }
    A.save(z);
    msg.textContent = 'Looking up ' + z + '…';
    A.full().then(function (p) {
      if (!p || p.lat == null) { msg.textContent = 'We could not find ZIP ' + z + ' in our table.'; return; }
      msg.textContent = '';
      form.hidden = true; btn.setAttribute('aria-expanded', 'false');
      try { root.dispatchEvent(new CustomEvent('agsist:bids')); } catch (er) {}
      start(true);
    });
  });

  /* ---------------- run */
  var worldDone = false;
  /* an odd number of cards: the last runs the full width on a wide screen (css), so no row is half empty */
  function even() {
    var cs = [].slice.call(d.querySelectorAll('#fp-cards .fp-card')).filter(function (c) { return !c.hidden; });
    cs.forEach(function (c, i) { c.classList.toggle('fp-wide', cs.length % 2 === 1 && i === cs.length - 1); });
  }
  even();
  function world(p) {
    $('fp-wh').textContent = p ? 'Around ' + nearName(p) : 'Around farm country';
    bidsCard(p); rainCard(p); mktCard(); fcCard(); landCard(p); fertCard(); arcCard(p); cotCard();
  }
  function start(changed) {
    place().then(function (p) {
      if (p && p.lat != null) {
        hero.classList.add('fp-saved');
        $('fp-where').textContent = 'Near ' + nearName(p) + (p.state && p.town ? ', ' + p.state : '');
        $('fp-set').textContent = 'Change place';
        $('fp-t1-k').textContent = 'Best corn bid'; $('fp-t2-k').textContent = 'Best soybean bid';
        answerSaved(p);
      } else answerFresh();
      if (changed || worldDone) { worldDone = true; world(p && p.lat != null ? p : null); return; }
      var near = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (es) {
        if (es.some(function (x) { return x.isIntersecting; })) { near.disconnect(); if (!worldDone) { worldDone = true; world(p && p.lat != null ? p : null); } }
      }, { rootMargin: '600px 0px' }) : null;
      if (near) near.observe($('fp-world')); else { worldDone = true; world(p && p.lat != null ? p : null); }
    });
    if (!changed) daily();
  }
  start(false);
})(typeof window !== 'undefined' ? window : this);
