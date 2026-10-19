/* components/cb-signup.js -- the bid email box near the top of /cash-bids and
   of every /cash-bids/<state>/<town> page. 2026-10-13.

   One email box, one button, two choices:
     1. "Every morning: the top corn and soybean bids within 50 mi of <town>"
        = AGSIST Daily with the town's ZIP (POST /subscribe {email, source,
        zip}). The Daily opens with that ZIP's top local bid
        (scripts/send_daily.py, scripts/local_bid.py: 50 mi). Same route and
        same single opt-in as every other Daily ask; components/signup-ask.js
        does the posting when it is on the page, so the signed-up cookie and
        the email_signup event stay in one place.
     2. "Tell me when <crop> within 25 mi pays $__"
        = the ZIP-wide cash alert components/cb-alerts.js already offers
        (POST /elevator-watch-subscribe, kind cash, ewid "ab" + ZIP + "025",
        mailed by scripts/send_zip_alert.py). Double opt-in, as before:
        nothing is sent until the reader presses the confirm link.
   No worker change. Every email carries its own unsubscribe link.

   A page asks with one tag (styles in components/cb-signup.css):
     <div data-bid-alerts data-place="Afton" data-zip="50830"
          data-source="town:iowa/afton" data-crops="corn soybeans"
          data-top="corn:4.12 soybeans:9.87"></div>
   /cash-bids passes data-zip-input="cb-zip" instead of data-zip: the box
   shows its own ZIP field, filled from the search box.
   A reader already on the Daily (agsist_subscribed) sees only the price alert.
   Neither box starts ticked for a new reader (Sig, 2026-10-19: no ask
   pre-ticks the Daily); pressing Email me with neither asks for one.

   Analytics: gaEvent('bid_alert_submit', ...) on a valid submit and
   gaEvent('bid_alert_ok', ...) for each part the service accepted. No
   address is ever sent to analytics. */
(function () {
  'use strict';
  if (window.CBSignup) { window.CBSignup.scan(); return; }
  var WORKER = 'https://agsist-subs.dnilgis.workers.dev';
  var MILES = 25;                                  /* one of cb-alerts.js RADII */
  var CROPS = ['corn', 'soybeans', 'wheat', 'sorghum', 'oats'];
  var NAMES = { corn: 'corn', soybeans: 'soybeans', wheat: 'wheat', sorghum: 'sorghum', oats: 'oats' };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var seq = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /* Byte-identical to components/cb-alerts.js widFor() (test/cb-signup.test.mjs
     checks it): FNV-1a 32-bit over UTF-16 units of the uppercased parts. */
  function widFor(a, b, c, d) {
    var s = [a, b, c, d].map(function (x) { return String(x || '').trim().toUpperCase(); }).join('|');
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function money(c) { return '$' + (c / 100).toFixed(2); }
  /* The ZIP-alert body, exactly as cb-alerts.js zipPanel() builds it. */
  function alertBody(email, zip, crop, cents) {
    var ewid = 'ab' + zip + ('00' + MILES).slice(-3);
    return { email: email, kind: 'cash', ewid: ewid, crop: crop, period: 'nearby', plabel: 'nearest delivery',
      direction: 'above', target_cents: cents,
      label: (crop.charAt(0).toUpperCase() + crop.slice(1) + ' at or above ' + money(cents) + ' within ' + MILES + ' mi of ZIP ' + zip).slice(0, 120),
      wid: widFor(ewid, 'cash', 'nearby', 'above:' + cents) };
  }
  function ga(name, params) {
    try {
      if (typeof window.gaEvent === 'function') window.gaEvent(name, params);
      else if (typeof window.gtag === 'function') window.gtag('event', name, params);
    } catch (e) {}
  }
  function store(k, v) { try { if (v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); } catch (e) { return null; } }
  function signedUp() {
    try { if (window.AgsistSignup && window.AgsistSignup.isSignedUp) return !!window.AgsistSignup.isSignedUp(); } catch (e) {}
    try {
      return /(^|;\s*)agsist_subscribed=/.test(document.cookie) || localStorage.getItem('agsist_subscribed') === '1';
    } catch (e) { return false; }
  }
  function post(path, body) {
    return fetch(WORKER + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        return { ok: !!(r.ok && d && d.ok === true), status: r.status, data: d };
      });
    }, function () { return { ok: false, status: 0, data: null }; });
  }
  function daily(email, zip, source) {
    var S = window.AgsistSignup;
    if (S && typeof S.subscribe === 'function') return S.subscribe({ email: email, source: source, zip: zip, zipField: true });
    return post('/subscribe', { email: email, source: String(source).slice(0, 60), reports: true, zip: zip }).then(function (res) {
      if (res.ok) {
        try {
          var exp = new Date(); exp.setFullYear(exp.getFullYear() + 2);
          document.cookie = 'agsist_subscribed=1;expires=' + exp.toUTCString() + ';path=/;SameSite=Lax';
          localStorage.setItem('agsist_subscribed', '1');
        } catch (e) {}
      }
      return res;
    });
  }
  function why(res, what) {
    var e = res && res.data && res.data.error ? String(res.data.error) : '';
    if (!res || res.status === 0) return 'Could not reach the ' + what + ' service. Nothing was saved. Check your connection and try again.';
    if (e === 'limit') return 'This address already has 5 elevator and price alerts, the most one address can hold. Nothing new was saved.';
    if (res.status === 429) return 'Too many sign-ups from here in the last hour. Nothing was saved. Try again later.';
    if (res.status >= 400 && res.status < 500 && /email/i.test(e)) return 'That email address was not accepted. Check it and try again.';
    return 'The ' + what + ' did not go through' + (res.status >= 400 ? ' (error ' + res.status + ')' : '') + '. Nothing was saved. Try again in a minute.';
  }

  function draw(el) {
    if (el.getAttribute('data-cbs-ready')) return;
    var id = 'cbs' + (++seq);
    var place = el.getAttribute('data-place') || '';
    var fixedZip = /^\d{5}$/.test(el.getAttribute('data-zip') || '') ? el.getAttribute('data-zip') : '';
    var zipIn = el.getAttribute('data-zip-input') ? document.getElementById(el.getAttribute('data-zip-input')) : null;
    if (!fixedZip && !zipIn) return;            /* no ZIP, nothing honest to offer */
    var source = (el.getAttribute('data-source') || 'cash-bids').slice(0, 60);
    var crops = (el.getAttribute('data-crops') || '').split(/\s+/).filter(function (c) { return CROPS.indexOf(c) >= 0; });
    if (crops.indexOf('corn') < 0) crops.unshift('corn');
    if (crops.indexOf('soybeans') < 0) crops.splice(1, 0, 'soybeans');
    var top = {};
    (el.getAttribute('data-top') || '').split(/\s+/).forEach(function (p) {
      var kv = p.split(':'), v = parseFloat(kv[1]);
      if (CROPS.indexOf(kv[0]) >= 0 && v >= 1 && v <= 32) top[kv[0]] = v.toFixed(2);
    });
    var onDaily = signedUp();
    var near = place ? esc(place) : 'you';
    var h = '<section class="cbs" aria-labelledby="' + id + '-h">'
      + '<h2 class="cbs-h" id="' + id + '-h">' + (place ? 'Get ' + esc(place) + ' bids by email' : 'Get the bids near you by email') + '</h2>'
      + '<form class="cbs-f" novalidate>'
      + '<div class="cbs-opt"' + (onDaily ? ' hidden' : '') + '><label class="cbs-ck"><input type="checkbox" class="cbs-d">'
      + '<span>Every morning: the top corn and soybean bids within 50 mi of <span class="cbs-where">' + near + '</span></span></label></div>'
      + '<div class="cbs-opt"><label class="cbs-ck" for="' + id + '-p"><input type="checkbox" class="cbs-p" id="' + id + '-p"' + (onDaily ? ' checked' : '') + '>'
      + '<span>Tell me when</span></label>'
      + '<select class="cbs-crop" aria-label="Crop">' + crops.map(function (c) { return '<option value="' + c + '">' + NAMES[c] + '</option>'; }).join('') + '</select>'
      + '<span>within ' + MILES + ' mi pays $</span>'
      + '<input type="number" class="cbs-price" inputmode="decimal" step="0.01" min="1" max="32" aria-label="Price you want, dollars a bushel">'
      + '</div>'
      + (zipIn ? '<div class="cbs-opt"><label class="cbs-ck" for="' + id + '-z">ZIP</label>'
        + '<input type="tel" class="cbs-zip" id="' + id + '-z" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="ZIP code"></div>' : '')
      + '<div class="cbs-row"><label class="cbs-sr" for="' + id + '-e">Email address</label>'
      + '<input type="email" class="cbs-em" id="' + id + '-e" autocomplete="email" inputmode="email" placeholder="Email address" aria-describedby="' + id + '-m">'
      + '<button type="submit" class="cbs-go">Email me</button></div>'
      + '<p class="cbs-ok" role="status"></p>'
      + '<p class="cbs-msg" id="' + id + '-m" role="alert"></p>'
      + '<p class="cbs-note">Free. ' + (onDaily ? '' : 'The morning email is AGSIST Daily: these bids first, then the markets. ')
      + 'A price alert checks the elevators whose own bid boards we read, and starts once you confirm it by email. Every email has an unsubscribe link.</p>'
      + '</form></section>';
    el.innerHTML = h;
    el.setAttribute('data-cbs-ready', '1');
    wire(el, { id: id, place: place, fixedZip: fixedZip, zipIn: zipIn, source: source, top: top, onDaily: onDaily });
  }

  function wire(el, o) {
    var form = el.querySelector('form'), d = form.querySelector('.cbs-d'), p = form.querySelector('.cbs-p');
    var crop = form.querySelector('.cbs-crop'), price = form.querySelector('.cbs-price'), zf = form.querySelector('.cbs-zip');
    var em = form.querySelector('.cbs-em'), msg = form.querySelector('.cbs-msg'), go = form.querySelector('.cbs-go');
    var okEl = form.querySelector('.cbs-ok');
    var where = form.querySelector('.cbs-where'), zipTouched = false;
    var saved = store('cba_email'); if (saved && EMAIL_RE.test(saved)) em.value = saved;
    function hint() { price.placeholder = o.top[crop.value] || ''; }
    hint();
    crop.addEventListener('change', function () { hint(); if (!p.checked) p.checked = true; });
    price.addEventListener('input', function () { if (price.value && !p.checked) p.checked = true; });
    function zipNow() { return o.fixedZip || String(zf && zf.value || '').replace(/\D/g, '').slice(0, 5); }
    function syncZip() {
      if (!zf || zipTouched) return;
      var v = String(o.zipIn.value || '').replace(/\D/g, '').slice(0, 5);
      zf.value = v;
      if (where) where.textContent = /^\d{5}$/.test(v) ? 'ZIP ' + v : 'your ZIP';
    }
    if (zf) {
      syncZip();
      ['input', 'change'].forEach(function (ev) { o.zipIn.addEventListener(ev, syncZip); });
      zf.addEventListener('input', function () {
        zipTouched = true;
        var v = zipNow(); if (where) where.textContent = /^\d{5}$/.test(v) ? 'ZIP ' + v : 'your ZIP';
      });
    }
    function bad(field, text) {
      msg.textContent = text;
      if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
      return false;
    }
    function clear() {
      msg.textContent = ''; okEl.innerHTML = '';
      [price, em, zf].forEach(function (f) { if (f) f.removeAttribute('aria-invalid'); });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clear();
      var wantD = !!(d && d.checked && !o.onDaily), wantP = !!p.checked;
      var zip = zipNow(), email = String(em.value || '').trim(), v = parseFloat(price.value);
      if (!wantD && !wantP) return bad(null, 'Tick the morning email, the price alert, or both.');
      if (!/^\d{5}$/.test(zip)) return bad(zf, 'Enter a 5-digit ZIP so we know whose bids to send.');
      if (wantP && !(v >= 1 && v <= 32)) return bad(price, 'Enter the price you want, between $1.00 and $32.00 a bushel.');
      if (!EMAIL_RE.test(email) || email.length > 254) return bad(em, 'Enter a real email address.');
      var cents = wantP ? Math.round(v * 100) : 0;
      ga('bid_alert_submit', { source: o.source, daily: wantD, price_alert: wantP, crop: wantP ? crop.value : '' });
      go.disabled = true; go.textContent = 'Sending…';
      Promise.all([
        wantD ? daily(email, zip, o.source) : null,
        wantP ? post('/elevator-watch-subscribe', alertBody(email, zip, crop.value, cents)) : null
      ]).then(function (r) {
        var dr = r[0], pr = r[1], okD = !!(dr && dr.ok), okP = !!(pr && pr.ok), done = [], errs = [];
        var at = o.place || ('ZIP ' + zip);
        if (okD) { done.push('<b>You are on AGSIST Daily.</b> The first one comes tomorrow morning, starting with the top bids near ' + esc(at) + '.'); ga('bid_alert_ok', { source: o.source, part: 'daily' }); }
        if (okP) { done.push('<b>Check your email to confirm the price alert</b> (' + esc(NAMES[crop.value]) + ' at ' + esc(money(cents)) + ' within ' + MILES + ' mi). The confirm email can take about 30 minutes; nothing about this alert is sent until you press it.'); ga('bid_alert_ok', { source: o.source, part: 'price', crop: crop.value }); }
        if (wantD && !okD) errs.push(why(dr, 'morning email'));
        if (wantP && !okP) errs.push(why(pr, 'price alert'));
        if (okD || okP) store('cba_email', email);
        if (!errs.length) {
          el.querySelector('.cbs').innerHTML = '<p class="cbs-done" tabindex="-1">' + done.join(' ') + ' Every email has an unsubscribe link.</p>';
          var t = el.querySelector('.cbs-done'); if (t) t.focus();
          return;
        }
        /* Keep what failed ticked so one press tries it again; what went through is unticked. */
        if (okD && d) { d.checked = false; d.closest('.cbs-opt').hidden = true; o.onDaily = true; }
        if (okP) p.checked = false;
        go.disabled = false; go.textContent = 'Email me';
        okEl.innerHTML = done.join(' ');
        msg.textContent = errs.join(' ');
        var bad1 = errs.join(' ').indexOf('email address') >= 0 ? em : null;
        if (bad1) { bad1.setAttribute('aria-invalid', 'true'); bad1.focus(); } else go.focus();
      });
    });
  }

  /* A "jump to the box" link higher up the page (the town pages' line under
     the title): land on the box with the email field ready. */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[data-bid-alerts-jump]');
    if (!a) return;
    var box = document.getElementById(a.getAttribute('href').slice(1));
    var f = box && box.querySelector('.cbs-em');
    if (!f) return;
    e.preventDefault();
    try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (x) { box.scrollIntoView(); }
    try { f.focus({ preventScroll: true }); } catch (x) { f.focus(); }
  });

  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-bid-alerts]:not([data-cbs-ready])'), draw);
  }
  window.CBSignup = { scan: scan, _widFor: widFor, _alertBody: alertBody };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();
