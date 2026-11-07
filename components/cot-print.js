/* The printed sheet on /cot (Nov 6, 2026, Sig: shareable by default, "nicely printed PDFs"; kit v2 the same day, the
   share kit panel: one short line per market, a six-number scoreboard readable from 6 feet, the year prominent, a true
   black-and-white palette).

   One page, US Letter portrait (it fits A4 too): the title with the week and its year, the Tuesday and the release
   day, then the scoreboard: corn, soybeans, Chicago wheat, live cattle, feeder cattle and lean hogs, each with its
   net in big figures, what funds bought or sold, and one context line (a measured record, else a run of 3 weeks or
   more, else the rank). Managed money and the rank are explained once, in a shared note. Then the corn chart drawn
   by the chart's own layout as SVG in print inks (AgCotChart.layout with print: dark gold #8a6514 net line, gray
   dashed price line), under its headline (AgCotGlance.brief: what changed, then where funds stand), the next report
   from cot.json's next_release, the source, and a QR code to the signup box on agsist.com/cot (#cot-signup).

   Nothing here fetches: the chart hands over the files cot-page.js loaded ('cot:chart-data'). The sheet sits at
   the end of <body>, hidden on screen (no layout shift). "Print this week" and any browser print (Ctrl+P, the
   menu, a phone's Print: beforeprint and matchMedia('print')) switch print to it (html.cotp-on,
   components/cot-print.css). The sheet element, the off-screen measure, the print hook and the html.sk-on shell
   (components/share-kit.css) come from the share kit core (components/share-kit.js). Exports window.AgCotPrint (and module.exports for the tests: sheet, html, run, lead). */
(function (root) {
  'use strict';
  var G = root.AgCotGlance || (typeof require === 'function' ? require('./cot-glance.js') : null);
  var C = root.AgCotChart || (typeof require === 'function' ? require('./cot-chart.js') : null);
  var K = root.AgCotKit || (typeof require === 'function' ? require('./cot-kit.js') : null);
  var KEYS = ['corn', 'beans', 'wheat', 'livecattle', 'feedercattle', 'leanhogs'];
  /* the QR code lands on the Funds this week signup box (Sig, Nov 6: grow the list); the printed URL stays short */
  var URL_SHOWN = 'agsist.com/cot', URL_FULL = 'https://agsist.com/cot#cot-signup', ASK = 'Every Friday by email:';
  /* the QR code's address carries the kit's tags (AgCotKit.link: utm_source=print, utm_medium=qr, the report week) */
  function qrUrl(week) { return K.link(null, week, 'print', 'qr', '#cot-signup'); }
  var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var esc = K.esc, num = K.commas, dt = K.dt;
  function and(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  /* A run of buying or selling ending with the report on the page (AgCotKit.run), or null. Nothing when the history
     does not end on the report the page shows with the same net. */
  function run(key, hist, cot) {
    var arr = hist && hist.history && hist.history[key], c = cot && cot[key];
    if (!arr || !c || typeof c.net !== 'number') return null;
    var rows = arr.filter(function (r) { return r && typeof r.net === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(r.date); })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var last = rows[rows.length - 1];
    if (!last || last.date !== G.iso(cot.report_date) || last.net !== c.net) return null;
    return K.run(rows);
  }

  /* The week in one line: "Funds sold corn, soybeans, Chicago wheat and lean hogs and bought live cattle and feeder
     cattle in the week to Tuesday, Oct 27, 2026." */
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
    return 'Funds ' + and(parts) + ' in the week to ' + DAY[d.getDay()] + ', ' + K.mdy(rd) + '.';
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

  /* The chosen market's chart by the page chart's own layout and SVG painter in print inks, h tall in a 560-wide box (fs 15). */
  function chartSvg(m, h) {
    var g = C.layout(m, 560, h, { fs: 15, print: true });
    return '<svg viewBox="0 0 560 ' + h + '" role="img" aria-label="' + esc(m.name) + ', managed money net position, each week since ' + esc(K.mdy(m.rows[0].date)) + '" xmlns="http://www.w3.org/2000/svg">' + C.toSvg(g) + '</svg>';
  }

  /* Everything on the sheet, as data. cot, cx, hist: the files the page loaded. now: ms. key: the market the reader
     picked (kit v2 part 2, pick your market): its headline leads and its chart is drawn; corn by default. */
  function sheet(cot, cx, hist, now, key) {
    if (!cot || !G.iso(cot.report_date)) return null;
    key = key && G.SHORT[key] ? key : 'corn';
    var cxA = cx && G.iso(cx.report_date) === G.iso(cot.report_date) ? cx : null;
    var markets = [];
    KEYS.forEach(function (k) {
      var f = G.facts(k, cot, cxA), b = G.brief(k, cot, cxA);
      if (!f || !b) return;
      var rn = run(k, hist, cot);
      /* one context line: a measured record, else the run, else the rank (explained once in the note) */
      var ctx = b.record ? '' : rn ? (rn.dir === 'bought' ? 'Bought ' : 'Sold ') + rn.weeks + ' weeks in a row: ' + num(rn.total)
        : f.words ? 'Rank: ' + f.words.replace(/ since \d{4}$/, '') : '';
      markets.push({ key: k, name: G.SHORT[k], net: f.net, side: f.side, chg: f.chg, record: b.record, run: rn, context: ctx,
        qty: K.qty(k, f.net) });
    });
    var chart = null, m = C && hist ? C.model(key, hist, cot, cxA) : null;
    if (m && !m.cmp) chart = { model: m, price: m.price, aligned: m.aligned, head: m.headlineHtml, svg: chartSvg(m, 300) };
    var since = (cxA && cxA.commodities && cxA.commodities.corn && cxA.commodities.corn.crowd && cxA.commodities.corn.crowd.since) || '2010';
    var rd = G.iso(cot.report_date);
    var note = 'Funds: managed money, CFTC’s name for hedge funds and commodity trading advisers. Net: their long contracts minus short. '
      + 'Rank: the net as a share of open interest, against every week since ' + since + '.';
    var src = 'Source: CFTC Commitments of Traders, managed money, futures only. '
      + (chart && chart.price ? G.SHORT[key] + ' price: front-month close each report Tuesday (Yahoo Finance), adjusted for contract rolls. ' : '')
      + K.SPEC_SRC + ' Not a price forecast.';
    var top = G.brief(key, cot, cxA);
    return { key: key, name: G.SHORT[key], title: 'Funds, week to ' + K.mdy(rd), asOf: G.weekLine(cot, cxA), top: top ? top.text : '',
      lead: lead(cot, cxA), markets: markets, chart: chart, next: nextLine(cot, cxA, now), note: note, src: src, url: URL_SHOWN, ask: ASK,
      qr: qrUrl(rd), week: rd };
  }

  function sideWords(mk) { return mk.side === 'flat' ? 'net ' + (mk.net < 0 ? 'short' : 'long') + ', about even' : 'net ' + mk.side; }
  function chgWords(mk) { return mk.chg == null ? '' : mk.chg === 0 ? 'Held steady' : (mk.chg > 0 ? '▲ Bought ' : '▼ Sold ') + num(mk.chg); }
  function html(s, qr, chartH) {
    if (!s) return '';
    var mk = s.markets.map(function (m) {
      return '<section class="cotp-m"><h2 class="cotp-n">' + esc(m.name) + '</h2>'
        + '<p class="cotp-fig"><b>' + esc(num(m.net)) + '</b> <span class="cotp-side">' + esc(sideWords(m)) + '</span></p>'
        + (chgWords(m) ? '<p class="cotp-chg">' + esc(chgWords(m)) + '</p>' : '')
        + (m.qty ? '<p class="cotp-bu">' + esc(m.qty.charAt(0).toUpperCase() + m.qty.slice(1)) + ' ' + esc(sideWords(m).replace(', about even', '')) + '</p>' : '')
        + (m.record ? '<p class="cotp-tag">' + esc(m.record) + '</p>' : m.context ? '<p class="cotp-s">' + esc(m.context) + '</p>' : '')
        + '</section>';
    }).join('');
    var chart = s.chart ? '<figure class="cotp-chart"><figcaption><span class="cotp-ch">' + esc(s.name) + '</span> '
      + 'Net contracts each week since ' + esc(K.mdy(s.chart.model.rows[0].date)) + ' (solid line)' + (s.chart.price ? '; ' + esc(s.name.toLowerCase()) + ' futures price below (dashed)' : '') + '.</figcaption>'
      + (chartH && chartH !== 300 ? chartSvg(s.chart.model, chartH) : s.chart.svg) + '</figure>' : '';
    var code = qr ? '<div class="cotp-qr">' + qr + '</div>' : '';
    return '<header class="cotp-top"><div><h1 class="cotp-h1">' + esc(s.title) + '</h1><p class="cotp-asof">' + esc(s.asOf) + '</p></div>'
      + '<div class="cotp-brand"><img class="cotp-logo" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="86" height="40"><p class="cotp-url">' + esc(s.url) + '</p></div></header>'
      + (s.top ? '<p class="cotp-lead"><b>' + esc(s.top) + '</b>' + (s.lead ? ' <span class="cotp-wk">' + esc(s.lead) + '</span>' : '') + '</p>'
        : s.lead ? '<p class="cotp-lead">' + esc(s.lead) + '</p>' : '')
      + '<div class="cotp-grid">' + mk + '</div>'
      + '<div class="cotp-low">' + chart + '<aside class="cotp-side-box"><p class="cotp-next">' + esc(s.next) + '</p>' + code
      + '<p class="cotp-free">' + esc(s.ask) + ' <span class="cotp-big">' + esc(s.url) + '</span></p></aside></div>'
      + '<p class="cotp-note">' + esc(s.note) + '</p><p class="cotp-src">' + esc(s.src) + '</p>';
  }

  /* PIN IT HERE (kit v2 part 2, Sig Nov 6): the wall edition. US Letter landscape, black and white, big type: the
     picked market's headline readable across a room, the six-market scoreboard (net, change and the week with its
     year), a QR code "Latest report and free Friday email" to the signup box, a blank "Posted by" line for a co-op or
     an elevator to write in, and the repost permission. Same data as the sheet (sheet()). */
  function wall(s, qr) {
    if (!s) return '';
    var mk = s.markets.map(function (m) {
      return '<section class="cotw-m"><h2 class="cotw-n">' + esc(m.name) + '</h2><p class="cotw-fig"><b>' + esc(num(m.net)) + '</b> '
        + esc(sideWords(m)) + '</p>' + (chgWords(m) ? '<p class="cotw-chg">' + esc(chgWords(m)) + '</p>' : '')
        + (m.qty ? '<p class="cotw-bu">' + esc(m.qty.charAt(0).toUpperCase() + m.qty.slice(1)) + ' net</p>' : '') + '</section>';
    }).join('');
    return '<header class="cotw-top"><p class="cotw-wk">' + esc(s.asOf) + '</p><p class="cotw-url">' + esc(s.url) + '</p></header>'
      + '<h1 class="cotw-h1">' + esc(s.top || s.title) + '</h1>'
      + '<div class="cotw-grid">' + mk + '</div>'
      + '<div class="cotw-low"><div class="cotw-txt"><p class="cotw-next">' + esc(s.next) + '</p>'
      + '<p class="cotw-post">Posted by <span class="cotw-blank"></span></p>'
      + '<p class="cotw-free">Free to print and post. Keep the source line.</p>'
      + '<p class="cotw-src">' + esc(s.src.replace(/ [A-Z][a-z]+(?: [a-z]+)? price: [^.]*\./, '')) + ' Funds: managed money (hedge funds and commodity trading advisers). Net: long contracts minus short.</p></div>'
      + '<div class="cotw-qrbox">' + (qr ? '<div class="cotw-qr">' + qr + '</div>' : '') + '<p class="cotw-ask">Latest report and free Friday email</p><p class="cotw-big">' + esc(s.url) + '</p></div></div>';
  }

  var api = { KEYS: KEYS, URL_FULL: URL_FULL, sheet: sheet, html: html, wall: wall, run: run, lead: lead, nextLine: nextLine, qrUrl: qrUrl };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgCotPrint = api;

  /* ---------------------------------------------------------------- the page */
  var doc = root.document, SK = root.AgShareKit, D = null, MAX_PX = 10.2 * 96 - 8, PICK = { key: null, wall: false };
  if (!doc || !SK) return;
  function qr(u) { try { return root.AgQR ? root.AgQR.svg(u || URL_FULL, 'QR code to the Funds this week signup at agsist.com/cot') : ''; } catch (e) { return ''; } }
  function chartKey() { try { return root.AgCotChart && root.AgCotChart.current ? root.AgCotChart.current() : null; } catch (e) { return null; } }
  function measure(el) { return SK.measure(el); }
  function build() {
    if (!D && root.AgCotChart && root.AgCotChart.data) D = root.AgCotChart.data();
    var s = D && sheet(D.cot, D.cx, D.hist, Date.now(), PICK.key || chartKey());
    if (!s) return null;
    var el = SK.sheet(doc, 'cotp', 'cotp');
    el.setAttribute('data-market', s.key);
    el.classList.toggle('cotp-wall', !!PICK.wall);
    el.style.zoom = '';
    if (PICK.wall) { el.innerHTML = wall(s, qr(s.qr)); el.setAttribute('data-fit', '1'); el.removeAttribute('data-zoom'); return el; }
    /* One page whatever the week says: measured off screen at A4's printed width (7.47 in, narrower than Letter)
       against Letter's printed height (10.2 in, shorter than A4); a long week gets a shorter chart, then tighter
       spacing and a smaller QR code; only past that is the whole sheet scaled down to fit. */
    var code = qr(s.qr), fits = false;
    el.style.zoom = '';
    [300, 260, 230].some(function (h, i) {
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
  /* any browser print (Ctrl+P, the menu, a phone's Print) gives the one-page sheet, the same state the button sets;
     GA4 sheet_print counts the print itself (beforeprint), whatever started it */
  function on() {
    var el = doc.getElementById('cotp');
    if (!doc.documentElement.classList.contains('cotp-on') && (el = build())) SK.show(doc, 'cotp-on', true);
    if (el) SK.ga(SK.EV.print, { kind: PICK.wall ? 'wall' : 'sheet', market: el.getAttribute('data-market') || '' });
  }
  function off() { SK.show(doc, 'cotp-on', false); PICK.key = null; PICK.wall = false; }
  SK.printHook(root, on, off);
  /* Print sheet, after the reader picks a market (components/cot-share.js): key, or wall for the pin-up edition.
     -> false while the data is still loading */
  api.print = function (key, isWall) {
    PICK.key = key || null; PICK.wall = !!isWall;
    if (!build()) { PICK.key = null; PICK.wall = false; return false; }
    SK.show(doc, 'cotp-on', true);
    SK.printNow(root, off);
    return true;
  };
})(typeof window !== 'undefined' ? window : this);
