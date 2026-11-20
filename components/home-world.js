/* components/home-world.js: the home page's "Near you" cards (Nov 20, 2026; fx/home-world).

   WHY. The owner (Nov 20): the home page should feel alive, every block equally strong. The first screen already carries
   the bids, futures, the Daily and a land sale; three things that move every day or week had no place on it: rain at the
   reader's place, the fertilizer price move, and ARC/PLC dollars for their county. Each card here is one fact from our own
   data files, with its source and its date: a big number, one line saying what it means, a small picture, a tap to the tool.

   WHAT EACH CARD READS (all files main's own jobs write; nothing typed by hand)
   - Rain.  Saved place with coordinates: the last 24 hours at that point from the NOAA MRMS radar file of its state
     (data/radar-rain/index.json, data/radar-rain/<st>.bin, decoded by components/radar-rain.js, loaded on demand), with the
     3-day, 7-day and month windows as bars. No place: the county averages of 12 Corn Belt states
     (data/radar-rain/county-<st>.json): how many counties got a tenth of an inch or more in the last 24 hours.
   - Fertilizer.  The /fertilizer page's own co-op price record (data/fertilizer-coops-history.json), replayed by that
     page's components/fert-trend.js (loaded on demand) with the page's rules: urea's middle co-op cash price (anhydrous
     when urea is withheld), its move since the change before and since the first, and every change as a line. The same
     for everyone: the co-ops are the ones the page reads.
   - ARC/PLC.  Saved county: its ARC/PLC page (/arc-plc/<state>/<county>), the same record its "Your check" box uses
     (data-pay, scripts/build_arc_plc.py pay_of), read for corn (else the first crop): the 2025 crop's ARC-CO and PLC per
     base acre at FSA's posted rates, the higher one big. No place, or no page: data/arc-plc.json, corn's 2026 effective
     reference price beside USDA's projected season-average price.

   RULES
   - Every card holds its room from the HTML (css in index.html): one-line label, the number, a two-line meaning, a 36 px
     picture, a one-line source. Nothing written here changes a card's height, so filling moves nothing.
   - A file that does not answer leaves an honest line ("could not read ... just now"), never an old number.
   - The number counts up once, when the card first comes into view; never again, and not at all with reduced motion.
   - Read only after the section comes near the screen (it sits below the first screen everywhere).
   - The place never leaves the browser: the rain file is a whole state and the ARC/PLC page a whole county.
   window.AgHomeWorld (node: module.exports, test/home-world.test.mjs). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BELT = ['IA', 'IL', 'IN', 'OH', 'MN', 'NE', 'WI', 'MO', 'SD', 'KS', 'ND', 'MI'];
  var STN = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
    DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

  /* ------------------------------------------------------------------ pure helpers (tested in node) */
  function ymd(iso) { var p = String(iso || '').slice(0, 10).split('-').map(Number); return p.length === 3 && p[0] ? p : null; }
  function md(iso) { var p = ymd(iso); return p ? MON[p[1] - 1] + ' ' + p[2] : ''; }
  /* a UTC instant as Central "7 pm Nov 19" */
  function ctStamp(iso) {
    var d = new Date(iso);
    if (!isFinite(d.getTime())) return '';
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      var t = p.minute === '00' ? p.hour : p.hour + ':' + p.minute;
      return t + ' ' + String(p.dayPeriod || '').toLowerCase() + ' ' + p.month + ' ' + p.day;
    } catch (e) { return md(iso); }
  }
  function money(v, dp) {
    var s = Math.abs(v).toFixed(dp == null ? 0 : dp).split('.');
    return (v < 0 ? '-' : '') + '$' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (s[1] ? '.' + s[1] : '');
  }
  function inch(h) { return (h / 100).toFixed(2); }
  function slug(s) { return String(s || '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  /* the county's ARC/PLC page, from the saved place: /arc-plc/iowa/story-county */
  /* "Story" -> "Story County", "Acadia" (LA) -> "Acadia Parish"; a name with its own ending stays */
  function countyName(st, county) {
    var c = String(county || '').trim();
    if (!c) return '';
    if (!/\b(county|parish|borough|city|census area|municipality)$/i.test(c)) c += st === 'LA' ? ' Parish' : ' County';
    return c;
  }
  function arcHref(st, county) {
    var n = STN[st], c = countyName(st, county);
    if (!n || !c) return '';
    return '/arc-plc/' + slug(n) + '/' + slug(c);
  }
  function heading(p) {
    if (!p || !p.town) return 'Across farm country';
    var a = 'Near ' + p.town + (p.state ? ', ' + p.state : '');
    return a.length <= 30 ? a : 'Near ' + p.town;
  }

  /* Rain, a saved point: {v (hundredths, 24h), w: [24h, 3d, 7d, month] (hundredths or null), end} or null */
  function rainPoint(windows, end) {
    if (!windows || windows[0] == null) return null;
    return { v: windows[0], w: windows, end: end };
  }
  function rainPointText(r, town, monthStart) {
    var bits = [];
    if (r.w[2] != null) bits.push(inch(r.w[2]) + ' in over 7 days');
    if (r.w[3] != null && monthStart) bits.push(inch(r.w[3]) + ' in since ' + md(monthStart));
    var lead = town && town.length <= 18 ? 'At ' + town + ': ' : '';
    return lead + (bits.length ? bits.join(', ') + '.' : 'The last 24 hours of radar and gauges.');
  }
  /* Rain, no place: the Corn Belt county counts from the county files */
  function beltCount(files) {
    var out = { n: 0, of: 0, n7: 0, states: [], end: '' };
    files.forEach(function (f) {
      if (!f || !f.counties) return;
      var n = 0, of = 0;
      Object.keys(f.counties).forEach(function (k) {
        var v = f.counties[k];
        if (!v || v[0] == null) return;
        of++; if (v[0] >= 10) n++;
        if (v[1] != null && v[1] >= 10) out.n7++;
      });
      if (!of) return;
      out.n += n; out.of += of;
      out.states.push({ st: f.st, share: n / of });
      if (!out.end || String(f.data_end) < out.end) out.end = String(f.data_end || '');
    });
    return out.of ? out : null;
  }
  function beltText(b) {
    return 'of ' + b.of.toLocaleString('en-US') + ' in ' + b.states.length + ' Corn Belt states got a tenth of an inch or more. Last 7 days: ' +
      b.n7.toLocaleString('en-US') + '.';
  }

  /* Fertilizer: one product's points from the /fertilizer page's own replay of the co-op price record
     (components/fert-trend.js series(): the middle of the co-ops' posted cash prices, each day it changed) ->
     {v, n, date, vals, dates, prev, first} or null. Withheld points (fewer than 2 co-ops) are left out. */
  function fertPts(pts) {
    var p = (pts || []).filter(function (x) { return x && x.mid != null && ymd(x.date); });
    if (!p.length) return null;
    var last = p[p.length - 1];
    return { v: last.mid, n: last.n, date: last.date, vals: p.map(function (x) { return x.mid; }), dates: p.map(function (x) { return x.date; }),
      prev: p.length > 1 ? p[p.length - 2] : null, first: p[0] };
  }
  function moveWords(d, since) {
    var r = Math.round(d);
    if (r === 0) return 'unchanged since ' + md(since);
    return (r > 0 ? 'up ' : 'down ') + money(Math.abs(r)) + ' since ' + md(since);
  }
  function fertText(f) {
    var s = 'Middle of ' + f.n + ' co-ops’ posted prices';
    if (!f.prev) return s + ', ' + md(f.date) + '.';
    s += ': ' + moveWords(f.v - f.prev.mid, f.prev.date);
    if (f.first && f.first !== f.prev) s += ', ' + moveWords(f.v - f.first.mid, f.first.date);
    return s + '.';
  }

  /* ARC/PLC, a county page: the data-pay record and the page's data date */
  function arcFromPage(html) {
    var m = /id="your-check" data-pay='([^']+)'/.exec(String(html || ''));
    if (!m) return null;
    var X; try { X = JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch (e) { return null; }
    var d = /data-asof-prefix="Data updated" datetime="(\d{4}-\d{2}-\d{2})"/.exec(html);
    var k = X.corn ? 'corn' : Object.keys(X)[0];
    var x = k && X[k];
    if (!x) return null;
    var a = x.r25a != null ? x.r25a * 0.85 : null, p = x.r25 != null && x.py != null ? x.r25 * x.py * 0.85 : null;
    if (a == null && p == null) return null;
    var hi = Math.max(a == null ? -1 : a, p == null ? -1 : p);
    return { crop: String(x.n || k), arc: a, plc: p, v: hi, prog: hi === a ? 'ARC-CO' : 'PLC', date: d ? d[1] : '' };
  }
  function arcText(r, name) {
    var c = name && name.length <= 24 ? name + ' ' : '';
    return c + r.crop.toLowerCase() + ', 2025 ' + r.prog + ' per base acre, the higher program, before the 5.7% cut.';
  }
  /* ARC/PLC, no county: corn's 2026 effective reference price and USDA's projection */
  function arcNational(j) {
    var y = j && j.years && j.years['2026'], c = y && y.crops && y.crops.corn;
    if (!c || !c.erp || !isFinite(+c.erp.erp)) return null;
    var u = c.scen && isFinite(+c.scen.usda) ? +c.scen.usda : null;
    return { v: +c.erp.erp, usda: u, usdaDate: c.scen && c.scen.usda_date || '', loan: +c.loan || null, date: j.updated || '' };
  }
  function arcNationalText(r) {
    var s = 'Corn PLC pays only if the 2026/27 season-average price ends below this.';
    if (r.usda != null) s += ' USDA projects ' + money(r.usda, 2) + '.';
    return s;
  }

  /* ------------------------------------------------------------------ small pictures (inline SVG, 36 px tall) */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function bars(items, label) {
    /* items: [{k, v (0..1 share of the tallest), t}] */
    var W = 300, n = items.length, gap = n > 6 ? 4 : 10, bw = (W - gap * (n - 1)) / n, h = '';
    items.forEach(function (it, i) {
      var x = i * (bw + gap), bh = Math.max(1, Math.round(it.v * 22));
      h += '<rect x="' + x.toFixed(1) + '" y="' + (23 - bh) + '" width="' + bw.toFixed(1) + '" height="' + bh + '" rx="1.5"></rect>' +
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="35" text-anchor="middle">' + esc(it.k) + '</text>';
    });
    return '<svg viewBox="0 0 300 36" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">' + h + '</svg>';
  }
  function spark(vals, dates, label) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 1, n = vals.length;
    var pts = vals.map(function (v, i) { return [n > 1 ? 6 + i * 288 / (n - 1) : 150, 22 - (v - lo) / span * 18]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var dots = pts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.5"></circle>'; }).join('');
    return '<svg viewBox="0 0 300 36" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '"><path d="' + d + '"></path>' + dots +
      '<text x="6" y="35">' + esc(md(dates[0])) + '</text><text x="294" y="35" text-anchor="end">' + esc(md(dates[n - 1])) + '</text></svg>';
  }

  var api = { md: md, ctStamp: ctStamp, money: money, slug: slug, countyName: countyName, arcHref: arcHref, heading: heading, rainPoint: rainPoint,
    rainPointText: rainPointText, beltCount: beltCount, beltText: beltText, fertPts: fertPts, fertText: fertText, arcFromPage: arcFromPage,
    arcText: arcText, arcNational: arcNational, arcNationalText: arcNationalText, bars: bars, spark: spark, BELT: BELT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.AgHomeWorld = api;

  /* ------------------------------------------------------------------ the page */
  var d = root.document;
  var sec = d.getElementById('hw');
  if (!sec) return;
  var still = false;
  try { still = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function get(u, kind) {
    return root.fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return kind === 'text' ? r.text() : kind === 'buf' ? r.arrayBuffer() : r.json(); });
  }
  function el(id) { return d.getElementById(id); }
  /* fill one card: c = {id, k, n, dp, pre, suf, s, g, src, href, a} */
  function fill(c) {
    var box = el('hw-' + c.id);
    if (!box) return;
    if (c.k) el('hw-' + c.id + '-k').textContent = c.k;
    var v = el('hw-' + c.id + '-v');
    v.innerHTML = '<span class="hw-n">' + esc((c.pre || '') + fmt(c.n, c.dp)) + '</span>' + (c.suf ? '<span class="hw-u">' + esc(c.suf) + '</span>' : '');
    el('hw-' + c.id + '-s').textContent = c.s;
    el('hw-' + c.id + '-g').innerHTML = c.g || '';
    el('hw-' + c.id + '-src').textContent = c.src;
    if (c.href) box.setAttribute('href', c.href);
    if (c.a) el('hw-' + c.id + '-a').textContent = c.a;
    box.classList.remove('hw-wait');
    tick(v.firstChild, c);
  }
  function fmt(n, dp) { var s = (+n).toFixed(dp || 0).split('.'); return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (s[1] ? '.' + s[1] : ''); }
  function fail(id, words) {
    var box = el('hw-' + id);
    if (!box) return;
    el('hw-' + id + '-v').innerHTML = '<span class="hw-none">No reading</span>';
    el('hw-' + id + '-s').textContent = words;
    el('hw-' + id + '-g').innerHTML = '';
    box.classList.remove('hw-wait');
  }
  /* the number counts up once, the first time it is on screen */
  var seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { seen.unobserve(e.target); if (e.target._hwRun) e.target._hwRun(); } });
  }, { threshold: 0.6 }) : null;
  function tick(node, c) {
    var box = el('hw-' + c.id);
    if (still) return;
    if (!seen || !node || !(c.n > 0) || !root.requestAnimationFrame) { box.setAttribute('data-counted', ''); return; }   /* nothing to count */
    var end = (c.pre || '') + fmt(c.n, c.dp);
    /* the figure's own width held while it counts (monospace, tabular digits), so the unit beside it never moves */
    node.style.display = 'inline-block'; node.style.minWidth = end.length + 'ch';
    node._hwRun = function () {
      var t0 = 0;
      box.classList.add('hw-tick');   /* while it counts; data-counted once it has (tests wait for it) */
      function step(t) {
        if (!t0) t0 = t;
        var q = Math.min(1, (t - t0) / 650), e = 1 - Math.pow(1 - q, 3);
        node.textContent = q < 1 ? (c.pre || '') + fmt(c.n * e, c.dp) : end;
        if (q < 1) root.requestAnimationFrame(step); else { box.classList.remove('hw-tick'); box.setAttribute('data-counted', ''); }
      }
      root.requestAnimationFrame(step);
    };
    seen.observe(node);
  }

  /* --- rain */
  var radarLib = null;
  function loadRadar() {
    if (root.AgRadarRain) return Promise.resolve(root.AgRadarRain);
    if (radarLib) return radarLib;
    radarLib = new Promise(function (ok, no) {
      var s = d.createElement('script'); s.src = '/components/radar-rain.js?v=1'; s.async = true;
      s.onload = function () { root.AgRadarRain ? ok(root.AgRadarRain) : no(new Error('no lib')); };
      s.onerror = function () { no(new Error('no lib')); };
      d.head.appendChild(s);
    });
    return radarLib;
  }
  function rainHere(p) {
    return Promise.all([get('/data/radar-rain/index.json'), loadRadar()]).then(function (a) {
      var idx = a[0], R = a[1], st = R.pickState(idx, p.lat, p.lon);
      if (!st) throw new Error('outside');
      return get('/data/radar-rain/' + st.toLowerCase() + '.bin', 'buf').then(R.parse).then(function (f) {
        var w = ['24h', '3d', '7d', 'month'].map(function (k) { return R.lookup(f.header, f.grids[k], p.lat, p.lon); });
        var r = rainPoint(w, idx.data_end);
        if (!r) throw new Error('no data');
        var top = Math.max.apply(null, w.map(function (x) { return x || 0; })) || 1;
        var ms = idx.windows && idx.windows.month && idx.windows.month.start;
        fill({ id: 'rain', k: 'Rain, last 24 hours', n: r.v / 100, dp: 2, suf: ' in', s: rainPointText(r, p.town, ms ? ctDay(ms) : ''),
          g: bars([{ k: '24 h', v: (w[0] || 0) / top }, { k: '3 days', v: (w[1] || 0) / top }, { k: '7 days', v: (w[2] || 0) / top }, { k: ms ? MON[+ctDay(ms).slice(5, 7) - 1] : 'Month', v: (w[3] || 0) / top }], 'Rain at this place by window'),
          src: 'NOAA radar with gauges, to ' + ctStamp(idx.data_end), href: '/field-rain', a: 'Rain at your fields →' });
      });
    });
  }
  function ctDay(iso) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso)); } catch (e) { return String(iso).slice(0, 10); } }
  function rainBelt() {
    return Promise.all(BELT.map(function (s) { return get('/data/radar-rain/county-' + s.toLowerCase() + '.json').catch(function () { return null; }); })).then(function (fs) {
      var b = beltCount(fs);
      if (!b) throw new Error('none');
      b.states.sort(function (x, y) { return BELT.indexOf(x.st) - BELT.indexOf(y.st); });
      /* bars on a fixed scale (half the counties = full height), so one wet county never looks like a wet state */
      var top = Math.max(0.5, Math.max.apply(null, b.states.map(function (s) { return s.share; })));
      fill({ id: 'rain', k: 'Corn Belt rain, last 24 hours', n: b.n, dp: 0, suf: b.n === 1 ? ' county' : ' counties', s: beltText(b),
        g: bars(b.states.map(function (s) { return { k: s.st, v: s.share / top }; }), 'Share of each state’s counties with rain'),
        src: 'NOAA radar county averages, to ' + ctStamp(b.end), href: '/rain#radar', a: 'Rain map →' });
    });
  }
  /* --- fertilizer */
  var trendLib = null;
  function loadTrend() {
    if (root.FertTrend) return Promise.resolve(root.FertTrend);
    if (trendLib) return trendLib;
    trendLib = new Promise(function (ok, no) {
      var s = d.createElement('script'); s.src = '/components/fert-trend.js?v=2'; s.async = true;
      s.onload = function () { root.FertTrend ? ok(root.FertTrend) : no(new Error('no lib')); };
      s.onerror = function () { no(new Error('no lib')); };
      d.head.appendChild(s);
    });
    return trendLib;
  }
  /* urea (else anhydrous): the co-op middle the /fertilizer page shows, replayed by that page's own fert-trend.js */
  function fertCard() {
    return Promise.all([get('/data/fertilizer-coops-history.json'), loadTrend()]).then(function (a) {
      var S = a[1].series(a[0], ctDay(new Date().toISOString())), P = (S && S.products) || {};
      var key = 'urea', f = fertPts(P.urea);
      if (!f) { key = 'anhydrous'; f = fertPts(P.anhydrous); }
      if (!f) throw new Error('none');
      var name = key === 'urea' ? 'urea' : 'anhydrous ammonia';
      fill({ id: 'fert', k: 'Fertilizer, ' + name, n: f.v, dp: 0, pre: '$', suf: ' a ton', s: fertText(f),
        g: f.vals.length > 1 ? spark(f.vals, f.dates, 'The middle co-op price of ' + name + ', each day it changed') : '',
        src: 'Co-op posted cash prices, ' + md(f.date) });
    });
  }
  /* --- ARC/PLC */
  function arcCounty(p) {
    var href = arcHref(p.state, p.countyRaw || p.county);
    if (!href) return Promise.reject(new Error('no county'));
    return get(href, 'text').then(function (html) {
      var r = arcFromPage(html);
      if (!r) throw new Error('no record');
      var top = Math.max(r.arc || 0, r.plc || 0) || 1;
      fill({ id: 'arc', k: 'ARC/PLC, your county', n: r.v, dp: 2, pre: '$', suf: ' an acre', s: arcText(r, countyName(p.state, p.countyRaw || p.county)),
        g: bars([{ k: 'ARC-CO ' + (r.arc == null ? 'none' : money(r.arc, 2)), v: (r.arc || 0) / top }, { k: 'PLC ' + (r.plc == null ? 'none' : money(r.plc, 2)), v: (r.plc || 0) / top }], 'ARC-CO and PLC per base acre'),
        src: 'FSA ARC/PLC data, updated ' + md(r.date), href: href + '#your-check', a: 'Your county’s check →' });
    });
  }
  function arcUS() {
    return get('/data/arc-plc.json').then(function (j) {
      var r = arcNational(j);
      if (!r) throw new Error('none');
      var top = Math.max(r.v, r.usda || 0) || 1;
      fill({ id: 'arc', k: 'ARC/PLC, corn price floor', n: r.v, dp: 2, pre: '$', suf: ' a bushel', s: arcNationalText(r),
        g: bars([{ k: 'PLC line ' + money(r.v, 2), v: r.v / top }].concat(r.usda != null ? [{ k: 'USDA ' + money(r.usda, 2), v: r.usda / top }] : []), 'Corn effective reference price and USDA projection'),
        src: 'FSA, USDA WASDE' + (r.usdaDate ? ' ' + r.usdaDate.replace(/, \d{4}$/, '') : '') });
    });
  }

  function place() {
    var A = root.AgSavedPlace;
    if (!A || !A.read || !A.read()) return Promise.resolve(null);
    return Promise.resolve(A.full ? A.full() : A.read()).then(function (p) {
      if (!p) return null;
      var raw = ''; try { raw = String((JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null') || {}).county || ''); } catch (e) {}
      p.countyRaw = raw && A.county && A.county(raw) === p.county ? raw : p.county;
      return p;
    }).catch(function () { return null; });
  }
  function run() {
    place().then(function (p) {
      el('hw-h').textContent = heading(p);
      var here = p && p.lat != null && p.lon != null;
      (here ? rainHere(p).catch(function () { return rainBelt(); }) : rainBelt())
        .catch(function () { fail('rain', 'Could not read the radar file just now. The rain pages have the last reading.'); });
      fertCard().catch(function () { fail('fert', 'Could not read the USDA fertilizer report file just now.'); });
      (p && p.state && p.county ? arcCounty(p).catch(function () { return arcUS(); }) : arcUS())
        .catch(function () { fail('arc', 'Could not read the ARC/PLC file just now.'); });
    });
  }
  var started = false;
  function go() { if (!started) { started = true; run(); } }
  if (typeof IntersectionObserver === 'function') {
    var near = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { near.disconnect(); go(); } }, { rootMargin: '900px 0px' });
    near.observe(sec);
  } else go();
})(typeof window !== 'undefined' ? window : this);
