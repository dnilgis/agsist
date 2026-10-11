/* components/rain-print-promo.js -- the seasonal Rain Print line, OFF unless
   Sig turns it on in data/rain-print.json:

     "promote": true                     the switch (ships false)
     "promote_from" / "promote_until"    YYYY-MM-DD, America/Chicago, inclusive
     "briefing_line": "..."              optional; the one line on /daily (null = none)

   Pages opt in with an empty, hidden element:
     <p class="rp-promo" data-rain-print-promo hidden></p>            the gift line
     <p class="rp-promo" data-rain-print-promo="briefing" hidden></p> the briefing line
   Off, out of the window, or on any failure, the element stays hidden and
   takes no space. One plain line and a link: no countdown, no badge.
   scripts/brief_email.py rain_print_line() applies the same rule to the email. */
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
  // The text for one placement, or '' for none.
  function lineFor(cfg, mode, today) {
    if (!isOn(cfg, today)) return '';
    if (mode === 'briefing') return typeof cfg.briefing_line === 'string' ? cfg.briefing_line.trim() : '';
    var by = ISO.test(cfg.framed_christmas_cutoff || '') ? cfg.framed_christmas_cutoff : cfg.promote_until;
    return "A year of your farm's rain, as a gift. Order framed by " + shortDate(by) + '.';
  }
  var api = { isOn: isOn, lineFor: lineFor, chicagoToday: chicagoToday };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgsistRainPromo = api;

  var doc = root.document;
  if (!doc || !doc.querySelectorAll) return;
  var els = doc.querySelectorAll('[data-rain-print-promo]');
  if (!els.length) return;
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  fetch('/data/rain-print.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      var today = chicagoToday();
      if (!isOn(cfg, today)) return;
      if (!doc.getElementById('rp-promo-css')) {
        var st = doc.createElement('style'); st.id = 'rp-promo-css';
        st.textContent = '.rp-promo{margin:.4rem 0 .8rem;font-size:.88rem;line-height:1.5;color:var(--text-dim)}' +
          '.rp-promo a{color:var(--brand);text-decoration:underline}' +
          '.rp-promo--home{max-width:1400px;margin:0 auto;padding:6px 16px 10px}';
        doc.head.appendChild(st);
      }
      for (var i = 0; i < els.length; i++) {
        var t = lineFor(cfg, els[i].getAttribute('data-rain-print-promo'), today);
        if (!t) continue;
        els[i].innerHTML = '<a href="/rain-print">' + esc(t) + '</a>';
        els[i].hidden = false;
      }
    })
    .catch(function () {});
})(typeof window !== 'undefined' ? window : this);
