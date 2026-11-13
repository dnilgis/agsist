/* components/rain-print-promo.js -- the quiet Rain Print and rain gauge
   promos. One shared file; a page opts in with ONE empty, hidden element
   placed after its main content (never above the fold, at most one a page):

     <p class="rp-promo" data-rain-print-promo hidden></p>            the gift line (promote + window)
     <p class="rp-promo" data-rain-print-promo="briefing" hidden></p> the briefing line (promote + window + briefing_line)
     <aside class="rp-card" data-rain-print-promo="card" hidden></aside>  the homepage card (promote)
     <p class="rp-promo" data-rain-print-promo="see" hidden></p>      "See a year of rain here as a print" (promote)
     <p class="rp-promo" data-rain-print-promo="gauge" hidden></p>    the rain gauge hook (gauge_hook)
     <p class="rp-promo" data-rain-print-promo="auto" hidden></p>     "see" or the gauge hook, by date (gauge_window)
     <p class="rp-promo" data-rain-print-promo="land" hidden></p>     the landlord and tenant gift line (promote + window; the rent pages)

   Switches, in data/rain-print.json:
     "promote": true                     on since launch (2026-10-13); false hides all but "gauge"
     "promote_from" / "promote_until"    YYYY-MM-DD, America/Chicago, inclusive (the gift line)
     "framed_christmas_cutoff"           the card's Christmas wording runs promote_from..this date
     "briefing_line": "..."              optional; the one line on /daily (null = none)
     "gauge_hook": {line, link}          the rain gauge's one line and link label, used wherever
                                         the gauge is linked (2026-10-23); missing or bad = no gauge line
     "gauge_window": {from, until, rain_print_until}
                                         "auto" (rain, weather, PRF, ARC/PLC and Fast Facts pages, 2026-10-23): the gauge hook from..until inclusive; nothing after
                                         rain_print_until and before from (Christmas Day); "see" any other day.
                                         A bad window leaves "auto" on "see".

   Bids, markets and rent pages never take "auto": they keep the gift line,
   which ends at promote_until (Dec 9).

   The card: Christmas wording from promote_from through the framed order-by
   date; then, through Dec 24 and only while the gift flow is in the data
   (gift_card_title), "give this year's print"; otherwise year-round wording.
   The Christmas card links /rain-print (2026-11-13: it went to /gifts-for-farmers, one page too many), says
   "$89 framed, order by Dec 9" from the data, and keeps "Gift ideas" as a smaller second link to
   /gifts-for-farmers; the other two link /rain-print. While the Christmas wording
   runs (through the framed order-by date), the card moves up to the page's
   empty [data-rp-card-early] marker, right under the homepage prices (Oct 23); after that date it stays where the page put it.
   xmasLine is the order-by sentence on /gifts-for-farmers, from the two
   Christmas cutoffs in data/rain-print.json: Oct 1 through Dec 25 of the
   cutoff's year only, a plain date, never a countdown.
   "see" links /rain-print with the reader's saved ZIP and last year when the
   site knows the ZIP (agsist-wx-loc), so the print opens already drawn.
   Off, out of the window, or on any failure, the element stays hidden and
   takes no space. No countdown, no badge, no pop-up. Clicks send one
   analytics event (rain_print_promo_click / rain_gauge_promo_click) with placement, from and page. Every
   Rain Print link here carries from= (home, or promo-<placement>), so /rain-print can report where its visitor came from
   (components/rain-print.js sends rain_print_landing {from}; the page's own Analytics address is the bare path).
   scripts/brief_email.py rain_print_line applies the briefing rule to the email. */
(function (root) {
  'use strict';
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function chicagoToday(now) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now || new Date()); }
    catch (e) { return (now || new Date()).toISOString().slice(0, 10); }
  }
  function isOn(cfg, today) {
    return !!(cfg && cfg.promote === true && ISO.test(cfg.promote_from || '') && ISO.test(cfg.promote_until || '') &&
              today >= cfg.promote_from && today <= cfg.promote_until);
  }
  function shortDate(iso) { var p = iso.split('-').map(Number); return MON[p[1] - 1] + ' ' + p[2]; }
  // The text for one line placement, or '' for none.
  // The gauge hook from data/rain-print.json: {line, link}, or null when it is
  // missing, empty, too long or carries a dash the house style rules out.
  function gaugeHook(cfg) {
    var g = cfg && cfg.gauge_hook, ok = function (t, n) { return typeof t === 'string' && t.trim() && t.length <= n && !/[\u2013\u2014]/.test(t); };
    if (!g || !ok(g.line, 90) || !ok(g.link, 60)) return null;
    return { line: g.line.trim(), link: g.link.trim() };
  }
  // "auto": which line a rain, weather, PRF, ARC/PLC or Fast Facts page shows today.
  function autoMode(cfg, today) {
    var w = cfg && cfg.gauge_window;
    if (!w || !ISO.test(w.from || '') || !ISO.test(w.until || '') || w.from > w.until || !ISO.test(today || '')) return 'see';
    if (today >= w.from && today <= w.until) return 'gauge';
    if (ISO.test(w.rain_print_until || '') && today > w.rain_print_until && today < w.from) return '';
    return 'see';
  }
  function lineFor(cfg, mode, today) {
    if (mode === 'auto') { mode = autoMode(cfg, today); if (!mode) return ''; }
    if (mode === 'gauge') { var h = gaugeHook(cfg); return h ? h.line + ' ' + h.link + '.' : ''; }
    if (mode === 'see') {
      if (!cfg || cfg.promote !== true) return '';
      return 'See a year of rain at your place, drawn as a print for the wall.';
    }
    if (!isOn(cfg, today)) return '';
    if (mode === 'briefing') return typeof cfg.briefing_line === 'string' ? cfg.briefing_line.trim() : '';
    var by = ISO.test(cfg.framed_christmas_cutoff || '') ? cfg.framed_christmas_cutoff : cfg.promote_until;
    if (mode === 'land') return 'For the landlord or the tenant: a year of rain on the home farm or the rented ground, printed for the wall. Order framed by ' + shortDate(by) + '.';
    return "A year of your farm's rain, as a gift. Order framed by " + shortDate(by) + '.';
  }
  // The homepage card: {angle, title, text, price} or null.
  function cardFor(cfg, today) {
    if (!cfg || cfg.promote !== true || !ISO.test(today || '')) return null;
    var price = typeof cfg.print12x18 === 'number' && cfg.print12x18 > 0
      ? 'Prints from $' + cfg.print12x18 + ', shipping included.' : '';
    var cut = ISO.test(cfg.framed_christmas_cutoff || '') ? cfg.framed_christmas_cutoff : '';
    var from = ISO.test(cfg.promote_from || '') ? cfg.promote_from : '';
    if (cut && from && today >= from && today <= cut) {
      var fr = typeof cfg.framed12x18 === 'number' && cfg.framed12x18 > 0 ? '$' + cfg.framed12x18 + ' framed' : 'Framed';
      return { angle: 'christmas', title: 'Their farm\u2019s year of rain, framed', href: '/rain-print', cta: 'Make yours',
        alt: { href: '/gifts-for-farmers', text: 'Gift ideas' },
        text: fr + ', order by ' + shortDate(cut) + ' for Christmas. Shipping included.', price: '' };
    }
    var dec24 = cut.slice(0, 4) + '-12-24';   // the cutoff's own December, so a stale cutoff never runs a gift line all next year
    if (cut && today > cut && today <= dec24 && typeof cfg.gift_card_title === 'string' && cfg.gift_card_title) {
      return { angle: 'gift', title: 'Still need a gift?', href: '/rain-print', cta: 'Make yours',
        text: 'Give this year’s Rain Print. Print a gift card for under the tree now; the print ships in January, once the year is in.', price: price };
    }
    return { angle: 'evergreen', title: 'A year of rain, printed for the wall', href: '/rain-print', cta: 'Make yours',
      text: 'Type your town and see every rain of the year at the nearest weather station, printed on 13 x 19 paper. Free to make.', price: price };
  }
  /* The Christmas order-by sentence for /gifts-for-farmers, or '' outside
     Oct 1..Dec 25 of the cutoffs' year or when a cutoff is missing. */
  function xmasLine(cfg, today) {
    var pc = cfg && cfg.print_christmas_cutoff, fc = cfg && cfg.framed_christmas_cutoff;
    if (!ISO.test(pc || '') || !ISO.test(fc || '') || !ISO.test(today || '')) return '';
    var y = pc.slice(0, 4);
    if (fc.slice(0, 4) !== y || today < y + '-10-01' || today > y + '-12-25') return '';
    if (today <= pc && today <= fc) return 'For Christmas delivery, order a framed print by ' + shortDate(fc) + ', a print by ' + shortDate(pc) + '.';
    if (today <= pc) return 'For Christmas delivery, order a print by ' + shortDate(pc) + '. A framed print ordered now ships after Christmas.';
    if (today <= fc) return 'For Christmas delivery, order a framed print by ' + shortDate(fc) + '. A print ordered now ships after Christmas.';
    return 'A past year ordered now ships after Christmas. The digital file still comes by email in 1 business day, or give this year\u2019s print: a gift card now, the print in January.';
  }
  // Where "see" points: the saved ZIP and last year when known, else the plain page.
  function seeHref(zip, today) {
    var y = parseInt(String(today || '').slice(0, 4), 10);
    if (/^\d{5}$/.test(String(zip || '')) && y > 1900) return '/rain-print?place=' + zip + '&year=' + (y - 1);
    return '/rain-print';
  }
  var api = { withFrom: function (h, f) { return withFrom(h, f); }, isOn: isOn, lineFor: lineFor, cardFor: cardFor, xmasLine: xmasLine, seeHref: seeHref, chicagoToday: chicagoToday, gaugeHook: gaugeHook, autoMode: autoMode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgsistRainPromo = api;

  var doc = root.document;
  if (!doc || !doc.querySelectorAll) return;
  var els = doc.querySelectorAll('[data-rain-print-promo]');
  if (!els.length) return;
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  function savedZip() {
    try { var o = JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null'); return o && /^\d{5}$/.test(o.zip || '') ? o.zip : ''; }
    catch (e) { return ''; }
  }
  function css() {
    if (doc.getElementById('rp-promo-css')) return;
    var st = doc.createElement('style'); st.id = 'rp-promo-css';
    st.textContent = '.rp-promo{margin:1.2rem 0 .8rem;font-size:.9rem;line-height:1.5;color:var(--text-dim)}' +
      '.rp-promo a{color:var(--brand);text-decoration:underline;text-underline-offset:2px}' +
      '.rp-card{margin:18px 0 0;padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)}' +
      '.rp-card:hover,.rp-card:focus-within{border-color:var(--brand)}' +
      'a.rp-card-main{display:flex;align-items:center;gap:16px;text-decoration:none;color:var(--text)}' +
      'a.rp-card-main:focus-visible,a.rp-card-alt:focus-visible{outline:2px solid var(--brand);outline-offset:2px}' +
      'a.rp-card-alt{display:inline-block;margin-top:8px;font-size:.82rem;color:var(--text-muted);text-decoration:underline;text-underline-offset:2px}' +
      'a.rp-card-alt:hover{color:var(--text)}' +
      '.rp-card-i{position:relative;flex:0 0 auto;width:220px}' +
      '.rp-card img{width:100%;height:auto;aspect-ratio:3/2;object-fit:cover;border-radius:3px;display:block}' +
      '.rp-card-b{min-width:0}' +
      '.rp-card-t{display:block;font-weight:700;font-size:.98rem;line-height:1.3;color:var(--text)}' +
      '.rp-card-x{display:block;margin-top:3px;font-size:.86rem;line-height:1.45;color:var(--text-dim)}' +
      '.rp-card-p{display:block;margin-top:5px;font-size:.84rem;color:var(--text-muted)}' +
      '.rp-card-p b{color:var(--brand);font-weight:600}' +
      '@media (max-width:520px){a.rp-card-main{flex-direction:column;align-items:stretch;gap:10px}.rp-card-i{width:100%}}';
    doc.head.appendChild(st);
  }
  // a link's own address plus from=<where>, ahead of any #
  function withFrom(href, from) {
    if (/[?&]from=/.test(href)) return href;
    var at = href.indexOf('#'), hash = at < 0 ? '' : href.slice(at), base = at < 0 ? href : href.slice(0, at);
    return base + (base.indexOf('?') < 0 ? '?' : '&') + 'from=' + from + hash;
  }
  function fromOf(el) { return (el.getAttribute('data-from') || '').replace(/[^a-z0-9-]/g, '').slice(0, 32); }
  function track(el, name) {
    el.addEventListener('click', function () {
      try { if (typeof root.gtag === 'function') root.gtag('event', name, { placement: el.getAttribute('data-placement') || '', from: fromOf(el), page: root.location.pathname, transport_type: 'beacon' }); } catch (e) {}
    });
  }
  function fill(cfg) {
    var today = chicagoToday();
    for (var i = 0; i < els.length; i++) {
      var el = els[i], mode = el.getAttribute('data-rain-print-promo') || '';
      var place = mode || 'gift';
      if (mode === 'card') {
        var c = cardFor(cfg, today);
        if (!c) continue;
        css();
        el.innerHTML = '<div class="rp-card"><a class="rp-card-main" href="' + esc(withFrom(c.href, 'home')) + '" data-from="home" data-placement="home-card-' + c.angle + '">' +
          '<span class="rp-card-i"><img src="/img/photos/rp-slot-card.jpg" width="720" height="480" alt="A framed Rain Print of Chetek, Wisconsin, 2025, hanging on a wall: the year\u2019s rain below the line, snow above" loading="lazy" decoding="async"></span>' +
          '<span class="rp-card-b"><span class="rp-card-t">' + esc(c.title) + '</span><span class="rp-card-x">' + esc(c.text) + '</span>' +
          '<span class="rp-card-p">' + (c.price ? esc(c.price) + ' ' : '') + '<b>' + esc(c.cta) + ' &rarr;</b></span></span></a>' +
          (c.alt ? '<a class="rp-card-alt" href="' + esc(c.alt.href) + '" data-from="home" data-placement="home-card-gifts">' + esc(c.alt.text) + '</a>' : '') + '</div>';
        if (c.angle === 'christmas') {
          var early = doc.querySelector('[data-rp-card-early]');
          if (early && early.parentNode) early.parentNode.insertBefore(el, early);
        }
        el.hidden = false;
        Array.prototype.forEach.call(el.querySelectorAll('a'), function (a) { track(a, 'rain_print_promo_click'); });
        continue;
      }
      var t = lineFor(cfg, mode, today);
      if (!t) continue;
      if (mode === 'auto') { mode = autoMode(cfg, today); place = 'auto-' + mode; }
      css();
      if (mode === 'gauge') {
        // the hook's line, then its link label as the link (gauge_hook)
        var gh = gaugeHook(cfg);
        el.innerHTML = esc(gh.line) + ' <a href="/rain-gauge" data-placement="' + esc(place) + '">' + esc(gh.link) + '</a>.';
        el.hidden = false;
        track(el.querySelector('a'), 'rain_gauge_promo_click');
        continue;
      }
      var href = mode === 'see' ? seeHref(savedZip(), today) : '/rain-print';
      el.innerHTML = '<a href="' + esc(withFrom(href, 'promo-' + place.replace(/[^a-z0-9-]/g, ''))) + '" data-from="promo-' + esc(place.replace(/[^a-z0-9-]/g, '')) + '" data-placement="' + esc(place) + '">' + esc(t) + '</a>';
      el.hidden = false;
      track(el.firstChild, 'rain_print_promo_click');
    }
  }
  // every line reads data/rain-print.json (the gauge hook lives there too); no file, no line
  fetch('/data/rain-print.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) { fill(cfg); })
    .catch(function () {});
})(typeof window !== 'undefined' ? window : this);
