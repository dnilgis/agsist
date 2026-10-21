/* components/rain-county-print.js: the county's year so far, drawn as a Rain
 * Print, on every county rain page (/rain/<state>/<county>), 2026-10-15.
 *
 * Sig: "put a rain print in place of that chart on every county rain page."
 * The page ships only a small placeholder: the plain running-total chart
 * (inline SVG, a few KB) inside <figure id="rc-print" data-...>. Nothing more
 * loads until that figure comes near the screen; then, once:
 *   /data/rain/daily/<st>.json          the chosen stations' days, one file a
 *                                       state (scripts/fetch_county_rain.py)
 *   /components/rain-print-art.js       the art itself (the same file /rain-print draws with)
 *   /components/rain-print.js           the engine's year numbers (RainPrint.derive);
 *                                       its page code runs only on /rain-print
 *   the print's two fonts                /fonts/rp-*.woff2
 * Each is shared and cached, so the second county costs one state file at most.
 * No NOAA call from here: the days are the ones this page was built from.
 *
 * HONEST: the print is drawn only when the days match this page: the same
 * number of days and the same total as the page says (data-days, data-total),
 * no more than 31 unrecorded days (the engine's MISS_BLOCK) and at least 60
 * days in (GIFT_MIN_DAYS). Anything else, or any failure, leaves the plain
 * chart where it is. A year still going is drawn as /rain-print draws it: a
 * PREVIEW band through the last reported day, the rest of the calendar empty.
 * Missing days are gaps; snow is drawn only where the station kept a snowfall
 * record (the engine's rule). No QR, no name: it shows what the print looks
 * like for this county; the button under it makes the reader's own.
 */
(function (root) {
  'use strict';
  var doc = root.document;
  /* mount(fig): the same drawing for any figure carrying these data- fields (2026-10-19:
     /here draws the nearest county station's year with it). It resolves true once the
     print is drawn, false when it is not (the plain chart stays). The county page's own
     #rc-print mounts itself, as before. */
  root.AgRainCountyPrint = { unpack: unpack, daysOf: daysOf, usualOf: usualOf, mount: mount };   // for test/rain-county-print.test.mjs
  var ART = '/components/rain-print-art.js?v=20', ENGINE = '/components/rain-print.js?v=65';
  // "Watch it draw" (2026-10-20): loaded only when a reader taps it
  var DRAW = '/components/rain-print-draw.js?v=2';
  var MISS_BLOCK = 31, MIN_DAYS = 60;
  var FONTS = [
    ['Fraunces', '/fonts/rp-fraunces-opsz.woff2', { weight: '300 600' }],
    ['IBM Plex Sans', '/fonts/rp-plex-sans-var.woff2', { weight: '300 600' }],
    ['Fraunces', '/fonts/rp-fraunces-opsz-400i.woff2', { weight: '400', style: 'italic' }],
    ['IBM Plex Sans', '/fonts/rp-plex-sans-400i.woff2', { weight: '400', style: 'italic' }]
  ];

  function script(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = doc.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ready() ? res() : rej(new Error(src)); };
      s.onerror = function () { rej(new Error(src)); };
      doc.head.appendChild(s);
    });
  }
  function fonts() {
    if (!root.FontFace || !doc.fonts) return Promise.resolve();
    return Promise.all(FONTS.map(function (f) {
      try {
        var ff = new root.FontFace(f[0], 'url(' + f[1] + ') format("woff2")', Object.assign({ display: 'swap' }, f[2]));
        doc.fonts.add(ff);
        return ff.load().then(null, function () {});
      } catch (e) { return null; }
    }));
  }

  /* data/rain/daily packing (scripts/county_rain.py pack_days): one token a
     day, M, T, S, or hundredths of an inch with A for a several-day total; a
     token repeated runs as tok*count. Back to ACIS's own strings. */
  function unpack(s) {
    var out = [];
    String(s || '').split(',').forEach(function (t) {
      if (!t) return;
      var k = 1, i = t.indexOf('*');
      if (i > 0) { k = +t.slice(i + 1); t = t.slice(0, i); }
      if (t !== 'M' && t !== 'T' && t !== 'S') {
        var a = /A$/.test(t);
        t = (parseInt(t, 10) / 100).toFixed(2) + (a ? 'A' : '');
      }
      for (var j = 0; j < k; j++) out.push(t);
    });
    return out;
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  /* The engine's days, built the way RainPrint's own daily() builds them. */
  function daysOf(RP, year, rec) {
    var p = unpack(rec.p), s = rec.s ? unpack(rec.s) : null, out = [];
    for (var i = 0; i < p.length; i++) {
      var dt = new Date(Date.UTC(year, 0, 1 + i));
      var iso = dt.toISOString().slice(0, 10), x = RP.parsePcpn(p[i]);
      var dy = { date: iso, v: x.v, flag: x.flag, t: null, s: s && s[i] !== undefined ? RP.parsePcpn(s[i]).v : null,
        m: dt.getUTCMonth(), d: dt.getUTCDate(), doy: i };
      // a snowfall trace (T): marked on the print, never counted (2026-10-20, as daily() does)
      if (s && RP.snowTraceRaw && RP.snowTraceRaw(s[i], iso)) dy.sT = true;
      out.push(dy);
    }
    out = out.slice(0, RP.lastRecorded(out) + 1);
    return RP.closeOpenS(out);
  }

  /* The usual-year line (2026-10-16). data-mn is NOAA's normal for each month, summed over the
     days this station reported (the page's own month table), data-usual their sum. Each month's
     figure is spread over that month's reported days, so the month and year usuals the print
     shows are NOAA's own sums; a day with no report adds nothing, as on the page. Null (no line)
     when anything fails to match: a month with a usual but no reported day, a sum that is not the
     page's usual, or no data at all. */
  function usualOf(days, mnText, usual) {
    if (!mnText) return null;
    var mn = String(mnText).split(',').map(Number);
    if (!mn.length || mn.some(function (v) { return !isFinite(v) || v < 0; })) return null;
    var rep = mn.map(function () { return 0; });
    days.forEach(function (x) { if (x.v !== null && x.v !== undefined && x.m < mn.length) rep[x.m]++; });
    for (var m = 0; m < mn.length; m++) if (mn[m] > 0 && !rep[m]) return null;
    var daily = days.map(function (x) {
      return x.v === null || x.v === undefined || x.m >= mn.length || !rep[x.m] ? 0 : mn[x.m] / rep[x.m];
    });
    var cum = [], run = 0;
    daily.forEach(function (v) { run += v; cum.push(run); });
    if (Math.abs(run - (+usual)) > 0.02) return null;
    return { normal: daily.slice(), daily: daily, cum: cum, total: run };
  }

  function mount(fig) {
    if (!fig || !fig.dataset) return Promise.resolve(false);
    var D = fig.dataset;
    var state = null;   // {RP, days, d, preview, ov}
    var lastInput = null, lastStyle = 'r1';
    function draw(style) {
      var A = root.AgRainArt, S = state, year = +D.year;
      if (root.AgRainDraw && root.AgRainDraw.current()) root.AgRainDraw.close();
      lastStyle = style;
      var svg = A.render(lastInput = {
        style: style, year: year, place: D.place, name: '', dedication: '',
        days: S.days, D: S.d, showDry: S.RP.showDry(S.d), axisLen: S.preview ? (isLeap(year) ? 366 : 365) : S.d.n,
        ov: S.ov, ovNote: S.ov ? (D.norm === '1991-2020' ? 'Usual: NOAA 1991 to 2020 normals, on the days reported' : 'Usual: NOAA 30-year normals, on the days reported') : '',
        showNormals: !!S.ov, markers: [], records: [], qr: null,
        preview: S.preview ? { last: S.days[S.days.length - 1].date } : null,
        gauge: D.gauge || '', logo: null, watermark: false, bleed: 0, idPrefix: 'rc'
      });
      lastInput = Object.assign({}, lastInput);
      var box = fig.querySelector('.rc-print-art');
      box.innerHTML = svg;
      var el = box.querySelector('svg');
      if (el) { el.removeAttribute('width'); el.removeAttribute('height'); }
      fig.querySelectorAll('button[data-style]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-style') === style ? 'true' : 'false'); });
    }

    function go() {
      return Promise.all([
        fetch('/data/rain/daily/' + D.st + '.json').then(function (r) { if (!r.ok) throw new Error('no days'); return r.json(); }),
        script(ART, function () { return !!root.AgRainArt; }).then(function () { return script(ENGINE, function () { return !!root.RainPrint; }); }),
        fonts()
      ]).then(function (res) {
        var j = res[0], RP = root.RainPrint, year = +D.year;
        var rec = j && j.counties && j.counties[D.fips];
        if (!rec || +j.year !== year) return false;
        var days = daysOf(RP, year, rec), d = RP.derive(days);
        // the print must be this page's year: the same days, the same total
        if (days.length !== +D.days || Math.abs(d.total - +D.total) > 0.011) return false;
        if (d.missing > MISS_BLOCK || days.length < MIN_DAYS) return false;
        state = { RP: RP, days: days, d: d, preview: days.length < (isLeap(year) ? 366 : 365), ov: usualOf(days, D.mn, D.usual) };
        draw('r1');
        fig.classList.add('rc-print-on');
        fig.hidden = false;   // county pages ship the print as a hidden shell after the farm content
        var cap = fig.querySelector('.rc-cap-print'), old = fig.querySelector('.rc-cap-chart');
        if (cap) cap.hidden = false;
        if (old) old.hidden = true;
        var tg = fig.querySelector('.rc-print-styles');
        if (tg) {
          tg.hidden = false;
          /* Watch it draw: the same print, drawing itself day by day, and a video of it
             (components/rain-print-draw.js). No hail or wind here: the page has no town point. */
          if (!tg.querySelector('.rc-watch')) {
            var wb = doc.createElement('button');
            wb.type = 'button'; wb.className = 'rc-watch'; wb.textContent = 'Watch it draw';
            wb.setAttribute('aria-label', 'Watch this year draw itself, and make a video of it');
            tg.appendChild(wb);
            wb.addEventListener('click', function () {
              script(DRAW, function () { return !!root.AgRainDraw; }).then(function () {
                var box = fig.querySelector('.rc-print-art');
                root.AgRainDraw.open({ input: lastInput, place: D.place, year: +D.year, name: '', url: 'https://agsist.com/rain-print', style: lastStyle, from: 'county' },
                  { host: box, after: box, from: 'county' });
              }, function () {});
            });
          }
          tg.addEventListener('click', function (e) {
            var b = e.target.closest('[data-style]');
            if (b) draw(b.getAttribute('data-style'));
            var z = e.target.closest('.rc-zoom');
            if (z) {
              var on = fig.classList.toggle('rc-print-zoom');
              z.setAttribute('aria-pressed', on ? 'true' : 'false');
              z.textContent = on ? 'Fit to screen' : 'Up close';
            }
          });
        }
        var lead = doc.getElementById('rc-sell-lead'), plain = doc.querySelector('.rc-sell-plain');
        if (lead) { lead.hidden = false; if (plain) plain.hidden = true; }
        return true;
      }).catch(function () { return false; /* the plain chart stays */ });
    }
    return new Promise(function (done) {
      function run() { go().then(done, function () { done(false); }); }
      if ('IntersectionObserver' in root) {
        var io = new root.IntersectionObserver(function (es) {
          if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); run(); }
        }, { rootMargin: '400px 0px' });
        // a hidden shell has no box to scroll into view: watch the line under it (county pages)
        io.observe(fig.hidden ? (fig.nextElementSibling || fig.parentNode) : fig);
      } else {
        run();
      }
    });
  }

  var own = doc && doc.getElementById('rc-print');
  if (own) mount(own);
})(typeof window !== 'undefined' ? window : this);
