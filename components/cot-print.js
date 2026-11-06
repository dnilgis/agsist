/* The printed "Funds this week" sheet on /cot (Nov 6, 2026, Sig: shareable by default, "nicely printed PDFs",
   "I have always loved a really well done infographic").

   One page, US Letter portrait (it fits A4 too): the wordmark and agsist.com/cot, the title, the Tuesday and the
   release day, the week in one line, then corn, soybeans, Chicago wheat, live cattle, feeder cattle and lean hogs,
   each with its net, the week's change, the page's own sentence (AgCotGlance.answer, the line under the chart
   title), any buying or selling run of 3 weeks or more, and the 52-week range from cot.json (min52, max52, the
   card bar's numbers). Then the corn chart drawn by the chart's own layout as SVG (AgCotChart.layout and toSvg,
   so it prints sharp), the next report from cot.json's next_release (the release bar's date, holiday-aware),
   the source, and a QR code to agsist.com/cot (components/qr.js).

   Nothing here fetches: the chart hands over the files cot-page.js loaded ('cot:chart-data'). The sheet sits at
   the end of <body>, hidden on screen (no layout shift); "Print this week" switches print to it
   (html.cotp-on, components/cot-print.css) and calls window.print(); the browser's "Save as PDF" makes the PDF.
   Exports window.AgCotPrint (and module.exports for the tests: sheet, html, run, lead). */
(function (root) {
  'use strict';
  var G = root.AgCotGlance || (typeof require === 'function' ? require('./cot-glance.js') : null);
  var C = root.AgCotChart || (typeof require === 'function' ? require('./cot-chart.js') : null);
  var KEYS = ['corn', 'beans', 'wheat', 'livecattle', 'feedercattle', 'leanhogs'];
  var URL_SHOWN = 'agsist.com/cot', URL_FULL = 'https://agsist.com/cot';
  var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function dt(s) { return new Date(String(s) + 'T12:00:00'); }
  function and(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  /* A run of buying or selling: the weeks in a row, ending with the report on the page, when managed money's net
     moved the same way each week (cot-history.json, weekly reports only; a missing week ends the run).
     -> {dir: 'bought'|'sold', weeks, total, text} for 3 weeks or more, else null. Nothing when the history does not
     end on the report the page shows with the same net. */
  function run(key, hist, cot) {
    var arr = hist && hist.history && hist.history[key], c = cot && cot[key];
    if (!arr || !c || typeof c.net !== 'number') return null;
    var rows = arr.filter(function (r) { return r && typeof r.net === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(r.date); })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var last = rows[rows.length - 1];
    if (!last || last.date !== G.iso(cot.report_date) || last.net !== c.net) return null;
    var sign = 0, weeks = 0, total = 0;
    for (var i = rows.length - 1; i > 0; i--) {
      if ((dt(rows[i].date) - dt(rows[i - 1].date)) / 86400000 > 8) break;
      var d = rows[i].net - rows[i - 1].net, s = d > 0 ? 1 : d < 0 ? -1 : 0;
      if (!s || (sign && s !== sign)) break;
      sign = s; weeks++; total += d;
    }
    if (weeks < 3) return null;
    var dir = sign > 0 ? 'bought' : 'sold';
    return { dir: dir, weeks: weeks, total: total,
      text: (dir === 'bought' ? 'Bought' : 'Sold') + ' in each of the last ' + weeks + ' weeks, ' + num(total) + ' contracts in all.' };
  }

  /* The week in one line, from the same facts the page's lines use:
     "Funds sold corn, soybeans, Chicago wheat and lean hogs and bought live cattle and feeder cattle in the week to
      Tuesday, Oct 27." */
  function lead(cot, cx, keys) {
    var rd = cot && G.iso(cot.report_date);
    if (!rd) return '';
    var sold = [], bought = [], held = [];
    (keys || KEYS).forEach(function (k) {
      var f = G.facts(k, cot, cx);
      if (!f || f.chg == null) return;
      (f.chg > 0 ? bought : f.chg < 0 ? sold : held).push(G.NAMES[k]);
    });
    var parts = [];
    if (sold.length) parts.push('sold ' + and(sold));
    if (bought.length) parts.push('bought ' + and(bought));
    if (held.length) parts.push('held ' + and(held) + ' steady');
    if (!parts.length) return '';
    var d = dt(rd);
    return 'Funds ' + and(parts) + ' in the week to ' + DAY[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + '.';
  }

  /* The next report for paper: a date, never "today" (the sheet outlives the day). From cot.json's next_release,
     through the release bar's own state (AgCotGlance.release). */
  function nextLine(cot, cx, now) {
    var nr = cot && cot.next_release, hm = (cot && cot.next_release_time_et) || '15:30';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nr || '')) return '';
    var r = G.release(cot, cx, now), w = G.when(nr, hm), mv = r.moved ? ' (moved from Friday for a holiday)' : '';
    if (r.state === 'due' || r.state === 'late') return 'A newer report was due ' + w + '. This sheet shows the one before it.';
    return 'Next report: ' + w + mv + '.';
  }

  /* The corn chart by the page chart's own layout and SVG painter, h tall in a 560-wide box (fs 15: 11 pt on paper). */
  function chartSvg(m, h) {
    var g = C.layout(m, 560, h, { fs: 15 });
    /* the gutter's short "long"/"short" words crowd the axis numbers at this size; the zero line and the dot's label say it */
    g.items = g.items.filter(function (it) { return !(it.t === 'text' && /^(long|short) [\u2191\u2193]$/.test(it.s)); });
    return '<svg viewBox="0 0 560 ' + h + '" role="img" aria-label="Corn, managed money net position, last 52 weeks" xmlns="http://www.w3.org/2000/svg">' + C.toSvg(g) + '</svg>';
  }

  /* Everything on the sheet, as data. cot, cx, hist: the files the page loaded. now: ms. */
  function sheet(cot, cx, hist, now) {
    if (!cot || !G.iso(cot.report_date)) return null;
    var cxA = cx && G.iso(cx.report_date) === G.iso(cot.report_date) ? cx : null;
    var markets = [];
    KEYS.forEach(function (k) {
      var f = G.facts(k, cot, cxA), a = G.answer(k, cot, cxA), c = cot[k];
      if (!f || !a) return;
      var rg = null;
      if (typeof c.min52 === 'number' && typeof c.max52 === 'number' && c.max52 > c.min52) {
        var lo = Math.min(c.min52, f.net), hi = Math.max(c.max52, f.net);
        rg = { lo: lo, hi: hi, net: f.net, at: (f.net - lo) / (hi - lo), zero: lo < 0 && hi > 0 ? (0 - lo) / (hi - lo) : null };
      }
      markets.push({ key: k, name: G.SHORT[k], net: f.net, side: f.side, chg: f.chg, crowded: f.crowded,
        sentence: a.did, run: run(k, hist, cot), range: rg });
    });
    var chart = null, m = C && hist ? C.model('corn', hist, cot, cxA) : null;
    if (m && !m.cmp) chart = { model: m, price: m.price, aligned: m.aligned, svg: chartSvg(m, 190) };
    var since = (cxA && cxA.commodities && cxA.commodities.corn && cxA.commodities.corn.crowd && cxA.commodities.corn.crowd.since) || '2010';
    var src = 'Source: CFTC Commitments of Traders, managed money, futures only. Rank: net as a share of open interest, against every week since ' + since
      + '.' + (chart && chart.price ? ' Corn price: front-month close each report Tuesday (Yahoo Finance), adjusted for contract rolls.' : '')
      + ' Not a price forecast.';
    return { asOf: G.asOf(cot, cxA), lead: lead(cot, cxA), markets: markets,
      chart: chart, next: nextLine(cot, cxA, now), src: src, url: URL_SHOWN };
  }

  function sideWords(mk) { return mk.side === 'flat' ? 'about even' : 'net ' + mk.side; }
  function chgWords(mk) { return mk.chg == null ? '' : mk.chg === 0 ? 'held steady' : (mk.chg > 0 ? 'bought ' : 'sold ') + num(mk.chg); }
  /* 95867 -> "95.9k short", 414460 -> "414.5k long" (the chart's own axis rounding) */
  function kWords(n) { return n === 0 ? '0' : C.kTick(Math.abs(n) >= 1000 ? Math.round(Math.abs(n) / 100) * 100 : Math.abs(n)) + (n > 0 ? ' long' : ' short'); }
  function rangeHtml(r) {
    if (!r) return '';
    var pct = function (v) { return (Math.round(v * 1000) / 10) + '%'; };
    return '<p class="cotp-rg"><span class="cotp-rk">52 wks</span><span>' + esc(kWords(r.lo)) + '</span><span class="cotp-rt" aria-hidden="true">'
      + (r.zero != null ? '<i class="cotp-r0" style="left:' + pct(r.zero) + '"></i>' : '')
      + '<i class="cotp-rm" style="left:' + pct(r.at) + '"></i></span><span>' + esc(kWords(r.hi)) + '</span></p>';
  }
  function html(s, qr, chartH) {
    if (!s) return '';
    var mk = s.markets.map(function (m) {
      return '<section class="cotp-m"><h2 class="cotp-mh"><span class="cotp-n">' + esc(m.name) + '</span>'
        + (m.crowded ? '<span class="cotp-tag">Crowded ' + esc(m.crowded) + '</span>' : '')
        + (chgWords(m) ? '<span class="cotp-chg">' + esc(chgWords(m)) + '</span>' : '') + '</h2>'
        + '<p class="cotp-fig"><b>' + esc(num(m.net)) + '</b> <span class="cotp-side">' + esc(sideWords(m)) + '</span></p>'
        + '<p class="cotp-s">' + esc(m.sentence) + (m.run ? ' <b class="cotp-run">' + esc(m.run.text) + '</b>' : '') + '</p>'
        + rangeHtml(m.range) + '</section>';
    }).join('');
    var chart = s.chart ? '<figure class="cotp-chart"><figcaption><b>Corn, last 52 weeks:</b> funds&rsquo; net, contracts (gold)'
      + (s.chart.price ? '; futures price (gray)' : '') + '.</figcaption>' + (chartH && chartH !== 190 ? chartSvg(s.chart.model, chartH) : s.chart.svg) + '</figure>' : '';
    var code = qr ? '<div class="cotp-qr">' + qr + '</div>' : '';
    return '<header class="cotp-top"><div><h1 class="cotp-h1">Funds this week</h1><p class="cotp-asof">' + esc(s.asOf) + '</p></div>'
      + '<div class="cotp-brand"><img class="cotp-logo" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="86" height="40"><p class="cotp-url">' + esc(s.url) + '</p></div></header>'
      + (s.lead ? '<p class="cotp-lead"><b>This week:</b> ' + esc(s.lead) + '</p>' : '')
      + '<div class="cotp-grid">' + mk + '</div>'
      + '<div class="cotp-low">' + chart + '<aside class="cotp-side-box"><p class="cotp-next">' + esc(s.next) + '</p>' + code
      + '<p class="cotp-big">' + esc(s.url) + '</p><p class="cotp-free">Every week, free.</p></aside></div>'
      + '<p class="cotp-src">' + esc(s.src) + '</p>';
  }

  var api = { KEYS: KEYS, sheet: sheet, html: html, run: run, lead: lead, nextLine: nextLine };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgCotPrint = api;

  /* ---------------------------------------------------------------- the page */
  var doc = root.document, D = null, MAX_PX = 10.2 * 96 - 8;
  if (!doc) return;
  function qr() { try { return root.AgQR ? root.AgQR.svg(URL_FULL, 'QR code to agsist.com/cot') : ''; } catch (e) { return ''; } }
  function measure(el) { el.classList.add('cotp-measure'); var h = el.offsetHeight; el.classList.remove('cotp-measure'); return h; }
  function build() {
    if (!D && root.AgCotChart && root.AgCotChart.data) D = root.AgCotChart.data();
    var s = D && sheet(D.cot, D.cx, D.hist, Date.now());
    if (!s) return null;
    var el = doc.getElementById('cotp');
    if (!el) { el = doc.createElement('div'); el.id = 'cotp'; el.className = 'cotp'; el.setAttribute('aria-hidden', 'true'); doc.body.appendChild(el); }
    /* One page whatever the week says: measured off screen at A4's printed width (7.47 in, narrower than Letter)
       against Letter's printed height (10.2 in, shorter than A4); a long week gets a shorter chart, then tighter
       spacing and a smaller QR code; only past that is the whole sheet scaled down to fit. */
    var code = qr(), fits = false;
    el.style.zoom = '';
    [190, 150, 130].some(function (h, i) {
      el.innerHTML = html(s, code, h);
      el.classList.toggle('cotp-tight', i === 2);
      fits = measure(el) <= MAX_PX;
      return fits;
    });
    if (!fits) { var z = Math.floor(MAX_PX / measure(el) * 100) / 100; el.style.zoom = String(z); el.setAttribute('data-zoom', String(z)); }
    else el.removeAttribute('data-zoom');
    el.setAttribute('data-fit', fits ? '1' : '0');
    return el;
  }
  api.build = build;
  doc.addEventListener('cot:chart-data', function (e) { D = e.detail || D; build(); });
  root.addEventListener('afterprint', function () { doc.documentElement.classList.remove('cotp-on'); });
  var btn = doc.getElementById('cc-print');
  if (btn) btn.addEventListener('click', function () {
    if (!build()) { var n = doc.getElementById('cc-note'); if (n) n.textContent = 'Still loading, try again in a moment'; return; }
    doc.documentElement.classList.add('cotp-on');
    try { if (typeof root.gtag === 'function') root.gtag('event', 'cot_print', {}); } catch (e) {}
    try { root.print(); } catch (e) { doc.documentElement.classList.remove('cotp-on'); }
  });
})(typeof window !== 'undefined' ? window : this);
