// The rain gauge ask on the rain pages (scripts/gauge_ask.py). The email box posts to the same waitlist the
// /rain-gauge page uses (subs worker /notice, topic rain-gauge); the page kind and the county or state FIPS
// go with it as source and fips. The address goes nowhere else: not a URL, not a log, not a counter.
(function () {
  'use strict';

  var EP = 'https://agsist-api.dnilgis.workers.dev/notice';
  var KEY = 'agsist_notices';
  var RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function listed() { try { var n = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; return !!n['rain-gauge']; } catch (e) { return false; } }
  function mark() { try { var n = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; n['rain-gauge'] = Date.now(); localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) {} }
  // The block's words and picture. The pages carry only an empty box with the page kind and FIPS (its height is held in
  // gauge-ask.css), so the 2,865 county pages stay small. Same endpoint, same fields as before.
  var PHOTO = '/img/rain-gauge/gauge-t-post.webp';
  var ALT = '3D render of the prototype rain gauge held to a green steel T-post by two metal clips, with fence wire and a field behind it';
  var KINDS = ['rain-county', 'rain-hub', 'rain-print'];
  function fill(box, kind, fips) {
    var lead = kind === 'rain-county' ? 'This page is one station. For your own field: ' : '';
    var q = '?src=' + kind + (fips ? '&fips=' + fips : '');
    box.innerHTML = '<figure class="gk-p"><img src="' + PHOTO + '" width="1200" height="750" loading="lazy" alt="' + ALT + '">' +
      '<figcaption>Prototype design, 3D render.</figcaption></figure>' +
      '<p class="gk-t">' + lead + '<b>I&rsquo;m building a rain gauge that keeps its own log.</b> Read it like any gauge. ' +
      'Or scan the code with your phone, and the reading goes into your log for that field. No battery, no app.</p>' +
      '<div class="gk-b"><form class="gk-f" action="/rain-gauge#waitlist" method="get" novalidate>' +
      '<label class="gk-l" for="gk-e">Email</label><input class="gk-e" id="gk-e" type="email" autocomplete="email" maxlength="254" placeholder="your@email.com">' +
      '<input class="gk-h" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button class="btn btn-primary" type="submit">Get on the waitlist</button></form>' +
      '<p class="gk-m" role="status" hidden></p></div>' +
      '<p class="gk-s">Free to join. The waitlist hears first and gets the first-batch price. No price is set yet. ' +
      '<a href="/rain-gauge' + q + '#waitlist">See the gauge</a>.</p>';
  }
  [].forEach.call(document.querySelectorAll('.gk'), function (box) {
    var kind = box.getAttribute('data-gk'), fips = box.getAttribute('data-fips') || '';
    if (KINDS.indexOf(kind) < 0) return;
    if (!/^(\d{2}|\d{5})$/.test(fips)) fips = '';
    fill(box, kind, fips);
    var f = box.querySelector('.gk-f'), m = box.querySelector('.gk-m'), e = box.querySelector('.gk-e'), btn = box.querySelector('button');
    function say(t, ok) { m.textContent = t; m.className = 'gk-m' + (ok ? '' : ' err'); m.hidden = false; }
    function thanks() {
      f.hidden = true;
      say('You are on the waitlist. I will email you first, with the price.', true);
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
