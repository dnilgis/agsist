/* components/rp-xmas.js -- the Christmas Rain Print line on the field and
   weather pages (Sig, 2026-10-30): one slim, quiet line in Sig's voice, near
   the top of the page, with his phone number for people who would rather he
   made the print for them (/rain-print has the "I'll make it for you" form).

   WIRING: one plain (not deferred) script tag inside <main>, near the top (on
   /hail-map under the map and its 5-year controls, on county rain pages under
   the print and its sell block, so a phone's first screen keeps those):
     <script src="/components/rp-xmas.js?v=1"></script>
   It writes the line just before itself while the page is still being read,
   so the line is there at the first paint and nothing below it ever moves
   (no fetch, no late fill). Outside the dates, or hidden by the reader,
   nothing is written and no space is taken.

   PAGES (and only these): /rain and every county rain page
   (scripts/build_county_rain.py), /rain-radar, /hail-map, /drought-monitor,
   /spray, /gdu-calculator, /field-scout and the Farmland Atlas county pages
   (scripts/build_atlas_pages.py). Never the home page or the Daily (Sig
   parked both until Nov 19). test/rp-xmas.test.mjs holds the list.

   DATES: FROM..UNTIL inclusive, America/Chicago. UNTIL is the last day a
   print can be ordered for Christmas delivery, print_christmas_cutoff in
   data/rain-print.json (the test keeps them the same).

   One Rain Print line a page (Oct 13 rule): while the line shows, the page's
   own after-content Rain Print line ([data-rain-print-promo], not the gauge
   line) stays hidden. The x hides the line for 30 days in this browser
   (localStorage, wrapped: blocked storage just means it shows).
   No countdown, no badge, no pop-up. Pure helpers on window.AgsistRpXmas. */
(function (root) {
  'use strict';
  var FROM = '2026-11-01', UNTIL = '2026-12-10';
  var KEY = 'agsist-rp-xmas-hide', DAYS = 30;
  var TEL = 'tel:+17157972428', PHONE = '(715) 797-2428';

  function chicagoToday(now) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now || new Date()); }
    catch (e) { return (now || new Date()).toISOString().slice(0, 10); }
  }
  function inWindow(today) { return /^\d{4}-\d{2}-\d{2}$/.test(today || '') && today >= FROM && today <= UNTIL; }
  // hidden: the time (ms) the reader pressed x, or anything else; now: ms
  function dismissed(hidden, now) {
    var t = Number(hidden);
    return isFinite(t) && t > 0 && now >= t && now - t < DAYS * 864e5;
  }
  function html() {
    return '<p class="rpx-t">A Rain Print of their farm’s year makes a good Christmas gift. ' +
      '<a href="/rain-print" data-placement="xmas-banner">Make one</a>, or call me and I’ll make it for you: ' +
      '<a href="' + TEL + '" class="rpx-tel" data-placement="xmas-banner-call">' + PHONE + '</a>.</p>' +
      '<button type="button" class="rpx-x" aria-label="Hide this for 30 days">×</button>';
  }
  var CSS = '.rpx{display:flex;align-items:flex-start;gap:.4rem;margin:.6rem 0 .9rem;padding:6px 6px 6px 11px;' +
    'border:1px solid var(--border);border-left:3px solid var(--brand);border-radius:6px;background:var(--surface);' +
    'font-size:.86rem;line-height:1.45;color:var(--text-dim);max-width:100%;box-sizing:border-box}' +
    '@media (max-width:520px){.rpx{font-size:.8rem;line-height:1.4;padding:5px 4px 5px 10px}}' +
    'aside.rpx p.rpx-t{flex:1;min-width:0;margin:0;font-size:inherit;line-height:inherit;color:inherit;max-width:none}' +
    'aside.rpx a{color:var(--brand);text-decoration:underline;text-underline-offset:2px}' +
    '.rpx-tel{white-space:nowrap}' +
    '.rpx-x{flex:none;width:30px;height:30px;margin:-3px 0 -3px 0;padding:0;border:0;border-radius:4px;background:none;' +
    'color:var(--text-muted);font-size:1.25rem;line-height:1;cursor:pointer}' +
    '.rpx-x:hover,.rpx-x:focus-visible{color:var(--text)}' +
    '.rpx-x:focus-visible{outline:2px solid var(--brand);outline-offset:1px}' +
    'html.rpx-on [data-rain-print-promo]:not([data-rain-print-promo="gauge"]){display:none!important}';

  var api = { FROM: FROM, UNTIL: UNTIL, KEY: KEY, DAYS: DAYS, chicagoToday: chicagoToday, inWindow: inWindow, dismissed: dismissed, html: html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgsistRpXmas = api;

  var doc = root.document, me = doc && doc.currentScript;
  // window.AGSIST_TODAY ("YYYY-MM-DD"): set only by tests (an init script), to run a page in and out of the dates
  var today = typeof root.AGSIST_TODAY === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(root.AGSIST_TODAY) ? root.AGSIST_TODAY : chicagoToday();
  if (!me || !me.parentNode || !inWindow(today)) return;
  var hid = null;
  try { hid = root.localStorage.getItem(KEY); } catch (e) { hid = null; }
  if (dismissed(hid, Date.now())) return;

  if (!doc.getElementById('rpx-css')) {
    var st = doc.createElement('style'); st.id = 'rpx-css'; st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  var box = doc.createElement('aside');
  box.className = 'rpx';
  box.setAttribute('aria-label', 'Rain Print for Christmas');
  box.innerHTML = html();
  me.parentNode.insertBefore(box, me);
  doc.documentElement.classList.add('rpx-on');

  var track = function (name, el) {
    try { if (typeof root.gtag === 'function') root.gtag('event', name, { placement: el.getAttribute('data-placement') || '', page: root.location.pathname }); } catch (e) {}
  };
  box.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { track('rain_print_promo_click', a); }); });
  box.querySelector('.rpx-x').addEventListener('click', function () {
    try { root.localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    box.parentNode && box.parentNode.removeChild(box);
    doc.documentElement.classList.remove('rpx-on');
    try { var m = doc.getElementById('main'); if (m) m.focus({ preventScroll: true }); } catch (e) {}
  });
})(typeof window !== 'undefined' ? window : this);
