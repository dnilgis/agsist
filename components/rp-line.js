/* components/rp-line.js -- one Rain Print line for the place on the page,
   through Christmas (Nov 20, 2026, the owner: put the print in front of the
   people already here). It names the page's own place and year, the price,
   and the approved Christmas answer for this year's print: a gift card under
   the tree now, the print in January (the county rain pages' own words).

   WIRING: one plain (not deferred) script tag where the line goes, after the
   page's answer, never above it:
     <script src="/components/rp-line.js?v=2" data-src="town" data-name="Ackley" data-place="Ackley, IA"></script>
   data-src   the source tag the link carries (src=<tag>), for the counts
   data-name  the place in the words ("Ackley's 2026 rain"); none = "Your farm's"
   data-place the place Rain Print draws; none = the reader's saved ZIP, if any
   It writes the line just before itself while the page is still being read,
   so the line is there at the first paint and nothing moves (no fetch, no
   late fill). Outside FROM..UNTIL nothing is written and no space is taken.

   PAGES: the cash bid town pages (scripts/build_cash_bid_pages.py) and
   /field-rain. The county rain pages carry their own sell block and Fast
   Facts its own link; test/rp-line.test.mjs holds the list.

   DATES: FROM..UNTIL inclusive, America/Chicago. UNTIL is Christmas Eve, the
   last day the gift card answer makes sense (the county rain pages' window).
   PRICE is data/rain-print.json print12x18 (the test keeps them the same).

   One Rain Print line a page: while this line shows, the page's own
   after-content gift line ([data-rain-print-promo], not the gauge line)
   stays hidden. No countdown, no badge, no pop-up. Pure helpers on
   window.AgsistRpLine. */
(function (root) {
  'use strict';
  var FROM = '2026-11-01', UNTIL = '2026-12-24', PRICE = 45;
  var ISO = /^\d{4}-\d{2}-\d{2}$/, SRC = /^[a-z0-9-]{1,24}$/;

  function chicagoToday(now) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now || new Date()); }
    catch (e) { return (now || new Date()).toISOString().slice(0, 10); }
  }
  function inWindow(today) { return ISO.test(today || '') && today >= FROM && today <= UNTIL; }
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  // the link: the place (or a saved ZIP) and this year, with the source tag
  function href(o, today) {
    var q = [], place = String(o.place || o.zip || '').trim().slice(0, 40);
    if (place) q.push('place=' + encodeURIComponent(place).replace(/%20/g, '+'));
    if (place && ISO.test(today || '')) q.push('year=' + today.slice(0, 4));
    if (SRC.test(o.src || '')) q.push('src=' + o.src);
    return '/rain-print' + (q.length ? '?' + q.join('&') : '');
  }
  // the line's html, or '' outside the dates
  function html(o, today) {
    if (!inWindow(today)) return '';
    var name = String(o.name || '').trim().slice(0, 40), year = today.slice(0, 4);
    var who = name ? esc(name) + '’s ' + year + ' rain' : 'Your farm’s ' + year + ' rain';
    return '<a href="' + esc(href(o, today)) + '" data-placement="line-' + esc(SRC.test(o.src || '') ? o.src : 'page') + '">' + who +
      ' as a Rain Print</a>, from $' + PRICE + '. Give it for Christmas: a card to give now, the print in January.';
  }
  var CSS = '.rpl{margin:1.2rem 0 .8rem;font-size:.9rem;line-height:1.5;color:var(--text-dim)}' +
    '.rpl a{color:var(--brand);text-decoration:underline;text-underline-offset:2px}' +
    'html.rpl-on [data-rain-print-promo]:not([data-rain-print-promo="gauge"]){display:none!important}';

  var api = { FROM: FROM, UNTIL: UNTIL, PRICE: PRICE, chicagoToday: chicagoToday, inWindow: inWindow, href: href, html: html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgsistRpLine = api;

  var doc = root.document, me = doc && doc.currentScript;
  // window.AGSIST_TODAY ("YYYY-MM-DD"): set only by tests (an init script), to run a page in and out of the dates
  var today = typeof root.AGSIST_TODAY === 'string' && ISO.test(root.AGSIST_TODAY) ? root.AGSIST_TODAY : chicagoToday();
  if (!me || !me.parentNode || !inWindow(today)) return;
  var o = { src: me.getAttribute('data-src') || '', name: me.getAttribute('data-name') || '', place: me.getAttribute('data-place') || '' };
  if (!o.place) {
    try { var s = JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null'); if (s && /^\d{5}$/.test(s.zip || '')) o.zip = s.zip; } catch (e) {}
  }
  if (!doc.getElementById('rpl-css')) {
    var st = doc.createElement('style'); st.id = 'rpl-css'; st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  var p = doc.createElement('p');
  p.className = 'rpl';
  p.innerHTML = html(o, today);
  me.parentNode.insertBefore(p, me);
  doc.documentElement.classList.add('rpl-on');
  var a = p.querySelector('a');
  if (a) a.addEventListener('click', function () {
    try { if (typeof root.gtag === 'function') root.gtag('event', 'rain_print_promo_click', { placement: a.getAttribute('data-placement') || '', page: root.location.pathname }); } catch (e) {}
  });
})(typeof window !== 'undefined' ? window : this);
