// The rain gauge ask on the rain pages (scripts/gauge_ask.py). The email box posts to the same waitlist the
// /rain-gauge page uses (subs worker /notice, topic rain-gauge); the page kind and the county or state FIPS
// go with it as source and fips. The address goes nowhere else: not a URL, not a log, not a counter.
(function () {
  'use strict';

  /* Nov 13, 2026 (Rain Print sales audit): a click on the Rain Print photo or either button in the county's Rain Print block
     sends one GA4 event, rain_print_click, with from=rain-county and which one. components/gauge-ask.js carries the same
     lines for pages where this file is not loaded; the flag keeps it to one listener. */
  if (!window.__rcSellTrack) {
    window.__rcSellTrack = 1;
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('.rc-sell [data-from]') : null;
      if (!a) return;
      try {
        if (typeof window.gtag === 'function') window.gtag('event', 'rain_print_click', { from: a.getAttribute('data-from'),
          button: a.classList.contains('rc-sell-img') ? 'photo' : (a.textContent || '').trim().slice(0, 30), page: window.location.pathname });
      } catch (x) {}
    });
  }
  var EP = 'https://agsist-api.dnilgis.workers.dev/notice';
  var KEY = 'agsist_notices';
  var RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function listed() { try { var n = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; return !!n['rain-gauge']; } catch (e) { return false; } }
  function mark() { try { var n = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; n['rain-gauge'] = Date.now(); localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) {} }
  [].forEach.call(document.querySelectorAll('.gk'), function (box) {
    var f = box.querySelector('.gk-f'), m = box.querySelector('.gk-m'), e = box.querySelector('.gk-e'), btn = box.querySelector('button');
    var kind = box.getAttribute('data-gk'), fips = box.getAttribute('data-fips') || '';
    function say(t, ok) { m.textContent = t; m.className = 'gk-m' + (ok ? '' : ' err'); m.hidden = false; }
    function thanks() {
      f.hidden = true;
      say('You are on the waitlist. I will email you when the first batch is ready, with the price, before anyone else.', true);
    }
    if (listed()) { thanks(); return; }
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = e.value.trim();
      if (!RE.test(v)) { say('That email does not look right. Check it and try again.', false); e.focus(); return; }
      var body = { email: v, topic: 'rain-gauge', source: kind, _gotcha: (box.querySelector('.gk-h') || {}).value || '' };
      if (fips) body.fips = fips;
      btn.disabled = true;
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
      var opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body) };
      if (ctl) opts.signal = ctl.signal;
      fetch(EP, opts)
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: !!(r.ok && d && d.ok === true), status: r.status }; }); })
        .then(function (res) {
          clearTimeout(timer);
          if (res.ok) {
            mark(); thanks();
            try { if (typeof window.gtag === 'function') window.gtag('event', 'notice_signup', { topic: 'rain-gauge', source: kind, form: 'rain-page' }); } catch (x) {}
          } else {
            btn.disabled = false;
            say(res.status === 429 ? 'Lots of people are signing up. Try again later.' : 'That did not go through. Try again in a minute.', false);
          }
        })
        .catch(function () { clearTimeout(timer); btn.disabled = false; say('That did not go through. Check your connection and try again.', false); });
    });
  });
})();
