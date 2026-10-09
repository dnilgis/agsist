/* AGSIST Daily signup asks: one component for every ask on the site.
   2026-10-06.

   Markup, CSS and logic live here and nowhere else. A page asks with one
   tag:

     <div data-signup-ask="Email me the best bids near me every morning"
          data-source="page:cash-bids"></div>

   Optional: data-variant="hero" (the homepage hero line), data-reports="0".
   Without data-source the source is "page:<slug of this path>".

   This file also owns:
     - the second-visit bar (sitewide; components/loader.js loads this file),
     - the visit counter (agsist_visits, counted once per browser session),
     - ?ref=email-forward (held in sessionStorage for the visit),
     - window.AgsistSignup: isSignedUp, setSignedUp, isDismissed,
       setDismissed, zip, subscribe, okText. The homepage's watch and price
       alert opt-ins and its signup band call subscribe() from here.

   Contract (SIGNUP.md, worker v5.4): POST /subscribe {email, source, reports,
   zip?}. A signup succeeds only on HTTP ok AND data.ok === true. Older
   workers ignore zip and reports and still subscribe the address.

   Honesty: no subscriber count, no timer, no box ticked without its label. */
(function () {
  'use strict';
  if (window.AgsistSignup && window.AgsistSignup._v) { window.AgsistSignup.scan(); return; }

  var EP = 'https://agsist-subs.dnilgis.workers.dev/subscribe';
  var DISMISS_DAYS = 35;
  var BAR_KEY = 'agsist_signup_bar_dismissed';
  var BAR_TEXT = 'AGSIST Daily: your local top bid and the markets, free, every morning';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  /* Placement sources that ?ref=email-forward replaces. A watch opt-in, a
     bid row or a page ask says more about why the reader signed up, so it
     keeps its own source. */
  var GENERIC = { hero: 1, bar: 1, 'signup-band': 1, footer: 1 };

  /* ---------- flags ---------- */
  function isSignedUp() {
    try {
      return document.cookie.split(';').some(function (c) { return c.trim().indexOf('agsist_subscribed=') === 0; })
        || localStorage.getItem('agsist_subscribed') === '1';
    } catch (e) { return false; }
  }
  function setSignedUp() {
    try {
      var exp = new Date(); exp.setFullYear(exp.getFullYear() + 2);
      document.cookie = 'agsist_subscribed=1;expires=' + exp.toUTCString() + ';path=/;SameSite=Lax';
      localStorage.setItem('agsist_subscribed', '1');
    } catch (e) {}
  }
  /* Same rule as index.html's helpers: a timestamp that expires after 35 days. */
  function isDismissed(key) {
    try { var v = parseInt(localStorage.getItem(key), 10); if (!v) return false; return (Date.now() - v) < DISMISS_DAYS * 864e5; }
    catch (e) { return false; }
  }
  function setDismissed(key) { try { localStorage.setItem(key, String(Date.now())); } catch (e) {} }

  /* ---------- visits: once per browser session ----------
     index.html runs the same gate inline (it reads the count before this
     file loads); whichever runs first counts the visit. */
  function countVisit() {
    try {
      if (sessionStorage.getItem('agsist_visit_counted')) return;
      sessionStorage.setItem('agsist_visit_counted', '1');
    } catch (e) { return; }
    try { localStorage.setItem('agsist_visits', String(parseInt(localStorage.getItem('agsist_visits') || '0', 10) + 1)); } catch (e) {}
  }
  function visits() { try { return parseInt(localStorage.getItem('agsist_visits') || '0', 10) || 0; } catch (e) { return 0; } }

  /* ---------- ?ref=email-forward ---------- */
  try { if (/(^|[?&])ref=email-forward(&|$)/.test(location.search)) sessionStorage.setItem('agsist_ref', 'email-forward'); } catch (e) {}
  function forwarded() { try { return sessionStorage.getItem('agsist_ref') === 'email-forward'; } catch (e) { return false; } }
  function sourceFor(base) {
    base = String(base || '').slice(0, 60);
    return GENERIC[base] && forwarded() ? 'email-forward' : base;
  }

  /* ---------- the reader's ZIP, from the saved location ---------- */
  function zip() {
    var z = '';
    try { var o = JSON.parse(localStorage.getItem('agsist-wx-loc') || 'null'); if (o && o.zip) z = String(o.zip); } catch (e) {}
    if (!/^\d{5}$/.test(z)) { try { z = String(localStorage.getItem('agsist_user_zip') || ''); } catch (e) { z = ''; } }
    if (!/^\d{5}$/.test(z)) { try { z = String(window.AGSIST_STATE.weather.zip || ''); } catch (e) { z = ''; } }
    return /^\d{5}$/.test(z) ? z : '';
  }

  /* The Daily goes out every morning, weekends included. */
  function okText() {
    return 'You’re in. First email tomorrow morning.';
  }

  function track(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch (e) {} }

  /* ---------- POST /subscribe ----------
     Resolves {ok, status, data}. ok only when HTTP ok and data.ok === true. */
  function subscribe(o) {
    o = o || {};
    var body = { email: String(o.email || '').trim(), source: sourceFor(o.source), reports: o.reports !== false };
    var z = /^\d{5}$/.test(String(o.zip || '')) ? String(o.zip) : zip();
    if (z) body.zip = z;
    return fetch(EP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        return { ok: !!(r.ok && d && d.ok === true), status: r.status, data: d };
      });
    }, function () { return { ok: false, status: 0, data: null }; })
      .then(function (res) {
        if (res.ok) {
          setSignedUp();
          track('email_signup', { source: body.source });
          try { window.dispatchEvent(new CustomEvent('agsist:signed-up', { detail: { source: body.source } })); } catch (e) {}
        }
        return res;
      });
  }
  function errText(res) {
    if (!res || res.status === 0) return 'Could not reach the signup service. Check your connection and try again.';
    var e = res.data && res.data.error ? String(res.data.error) : '';
    if (res.status >= 400 && res.status < 500 && /email/i.test(e)) return 'That email address was not accepted. Check it and try again.';
    return 'That did not go through' + (res.ok || res.status < 400 ? '' : ' (error ' + res.status + ')')
      + '. Nothing was saved. Try again, or email sig@farmers1st.com and I will add you by hand.';
  }

  /* ---------- CSS ---------- */
  var CSS = [
    '.sa-ask{font-family:var(--font-body,Inter,system-ui,sans-serif);color:var(--text);margin:14px 0}',
    '.sa-ask[hidden],.sa-bar[hidden],[data-signup-hide][hidden]{display:none!important}',
    /* narrow: the line on top, then field and button side by side */
    '.sa-f{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 8px;margin:0}',
    '.sa-l{grid-column:1/-1}',
    '.sa-in{grid-column:1}.sa-b{grid-column:2}.sa-m{grid-column:1/-1}',
    /* wide: one row, line | field | button */
    '@media (min-width:900px){.sa-f{grid-template-columns:minmax(0,1fr) minmax(12rem,20rem) auto;gap:6px 10px}.sa-l{grid-column:1}.sa-in{grid-column:2}.sa-b{grid-column:3}}',
    '.sa-l{min-width:0;font-size:.9375rem;font-weight:600;line-height:1.35;color:var(--text)}',
        '.sa-in{min-width:0;width:100%;box-sizing:border-box;min-height:44px;padding:.5rem .7rem;font:inherit;font-size:1rem;color:var(--text);background:var(--surface,#fff);border:1px solid var(--border-2,var(--border));border-radius:6px}',
    '.sa-in::placeholder{color:var(--text-muted);opacity:1}',
    '.sa-in:focus{outline:2px solid var(--gold);outline-offset:1px;border-color:var(--gold)}',
    '.sa-in[aria-invalid="true"]{border-color:var(--red)}',
    '.sa-b{min-height:44px;padding:.5rem .9rem;font:inherit;font-size:.9375rem;font-weight:700;color:#0a0c0d;background:#d4a23f;border:0;border-radius:6px;cursor:pointer;white-space:nowrap}',
    '.sa-b:hover{filter:brightness(.94)}',
    '.sa-b:focus-visible{outline:2px solid var(--text);outline-offset:2px}',
    '.sa-b[disabled]{opacity:.75;cursor:default}',
    '.sa-m{margin:0;font-size:.875rem;line-height:1.4;color:var(--red)}',
    '.sa-m:empty{display:none}',
    '.sa-ok{margin:0;font-size:.9375rem;font-weight:700;line-height:1.4;color:var(--green)}',
    '.sa-ok:focus{outline:none}',
    /* page asks: a quiet band, one line plus a field */
    '.sa-ask--page{padding:12px 14px;background:var(--surface2,var(--surface));border:1px solid var(--border-2,var(--border));border-left:3px solid var(--gold);border-radius:8px}',
    /* the homepage hero line, under the bids */
    '.sa-ask--hero{margin:0;padding:6px 0 8px;border-top:1px solid var(--border-2)}',
    '.sa-ask--hero .sa-l{font-size:.875rem}',
    '@media (max-width:639px){',
    /* phone: the label sits inside the field box, so the line costs one row */
    '  .sa-ask--hero{padding:5px 0 6px}',
    '  .sa-ask--hero .sa-f{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 6px;align-items:stretch}',
    '  .sa-ask--hero .sa-box{grid-column:1;grid-row:1;display:flex;flex-direction:column;justify-content:center;min-width:0;padding:3px 10px 2px;background:var(--surface,#fff);border:1px solid var(--border-2,var(--border));border-radius:6px}',
    '  .sa-ask--hero .sa-box:focus-within{outline:2px solid var(--gold);outline-offset:1px;border-color:var(--gold)}',
    '  .sa-ask--hero .sa-l{flex:none;font-size:13px;font-weight:500;line-height:1.25;color:var(--text-muted)}',   /* fits one line from 375px; wraps, never cut, below that */
    '  .sa-ask--hero .sa-in{flex:none;width:100%;min-height:24px;height:24px;padding:0;border:0;background:transparent;border-radius:0}',
    '  .sa-ask--hero .sa-in:focus{outline:none}',
    '  .sa-ask--hero .sa-b{grid-column:2;grid-row:1;padding:0 .75rem}',
    '  .sa-ask--hero .sa-m{grid-column:1/-1;margin-top:4px}',
    '}',
    /* tablet and up: one row, the line | the field | the button */
    '@media (min-width:640px){.sa-ask--hero .sa-f{grid-template-columns:minmax(0,1fr) auto}.sa-ask--hero .sa-box{grid-column:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(12rem,22rem);gap:6px 10px;align-items:center}.sa-ask--hero .sa-l,.sa-ask--hero .sa-in{grid-column:auto}.sa-ask--hero .sa-b{grid-column:2}}',
    /* the opt-in box on the watch and price alert forms */
    '.sa-optin{display:flex;align-items:flex-start;gap:8px;min-height:44px;padding:6px 0;font-family:var(--font-body,Inter,system-ui,sans-serif);font-size:.875rem;line-height:1.4;color:var(--text);cursor:pointer}',
    '.sa-optin input{flex:none;width:20px;height:20px;margin:0;accent-color:var(--gold);cursor:pointer}',
    '.sa-optin[hidden]{display:none}',
    '.sa-optmsg{font-size:.875rem;line-height:1.4;margin-top:4px}',
    '.sa-optmsg.is-ok{color:var(--green)}.sa-optmsg.is-err{color:var(--red)}',
    /* the second-visit bar */
    '.sa-bar{position:fixed;left:0;right:0;bottom:0;z-index:9990;box-sizing:border-box;padding:8px max(16px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:var(--surface,#fff);border-top:2px solid var(--gold);box-shadow:0 -4px 18px rgba(0,0,0,.18);font-family:var(--font-body,Inter,system-ui,sans-serif);color:var(--text)}',
    '.sa-bar.is-off{visibility:hidden;transform:translateY(110%)}',
    '@media (prefers-reduced-motion:no-preference){.sa-bar{transition:transform .3s ease,visibility .3s}}',
    '.sa-bar-in{display:flex;align-items:center;gap:6px 12px;max-width:1180px;margin:0 auto}',
    '.sa-bar .sa-ask{flex:1 1 auto;margin:0;min-width:0}',
    '.sa-bar .sa-l{font-size:.9375rem;font-weight:600}',

    '.sa-x{flex:none;align-self:center;width:44px;height:44px;padding:0;background:none;border:0;border-radius:6px;color:var(--text-muted);font:inherit;font-size:1.25rem;line-height:1;cursor:pointer}',
    '.sa-x:hover{color:var(--text)}.sa-x:focus-visible{outline:2px solid var(--gold);outline-offset:0}',
    '@media (max-width:639px){',
    '  .sa-bar{padding-top:4px;padding-bottom:max(6px,env(safe-area-inset-bottom))}',
    '  .sa-bar-in{align-items:flex-start;gap:0 4px}',
    '  .sa-bar .sa-l{font-size:.8125rem;line-height:1.3;padding:2px 0 0}',
    '  .sa-bar .sa-in,.sa-bar .sa-b{min-height:42px}',
    '  .sa-x{width:40px;height:40px;margin-top:-2px;margin-right:-8px}',
    '}',
    '@media print{.sa-bar,.sa-ask{display:none!important}}'
  ].join('\n');
  function css() {
    if (document.getElementById('sa-css')) return;
    var s = document.createElement('style'); s.id = 'sa-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- one ask ---------- */
  var seq = 0;
  function slug() { return (location.pathname.replace(/\/+$/, '').replace(/^\//, '').replace(/\.html$/, '') || 'home').slice(0, 54); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function mount(el) {
    if (!el || el.getAttribute('data-sa-ready')) return;
    el.setAttribute('data-sa-ready', '1');
    if (isSignedUp()) { el.hidden = true; return; }
    css();
    var copy = el.getAttribute('data-signup-ask') || BAR_TEXT;
    var variant = el.getAttribute('data-variant') || 'page';
    var source = el.getAttribute('data-source') || ('page:' + slug());
    var reports = el.getAttribute('data-reports') !== '0';
    var BTN = variant === 'hero' ? 'Sign up' : 'Sign up free';
    var n = ++seq, iid = 'sa-e-' + n, mid = 'sa-m-' + n;
    el.classList.add('sa-ask', 'sa-ask--' + variant);
    el.innerHTML = '<form class="sa-f" novalidate>'
      + (variant === 'hero' ? '<span class="sa-box">' : '')
      + '<label class="sa-l" for="' + iid + '">' + esc(copy) + '</label>'
      + '<input class="sa-in" id="' + iid + '" type="email" name="email" autocomplete="email" inputmode="email" placeholder="your@email.com" required aria-describedby="' + mid + '">'
      + (variant === 'hero' ? '</span>' : '')
      + '<button class="sa-b" type="submit">' + BTN + '</button>'
      + '<p class="sa-m" id="' + mid + '" role="status" aria-live="polite"></p>'
      + '</form>';
    el.hidden = false;
    var form = el.querySelector('form'), input = el.querySelector('.sa-in'), btn = el.querySelector('.sa-b'), msg = el.querySelector('.sa-m');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (input.value || '').trim();
      if (!EMAIL_RE.test(email)) {
        msg.textContent = 'Enter a real email address.';
        input.setAttribute('aria-invalid', 'true'); input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      msg.textContent = '';
      btn.disabled = true; btn.textContent = 'Sending…';
      el.setAttribute('data-sa-busy', '1');
      /* A page with its own ZIP box (cash-bids) names it; else the saved location. */
      var zi = el.getAttribute('data-zip-input'), zv = zi && document.getElementById(zi) ? String(document.getElementById(zi).value || '').trim() : '';
      /* A town page names its own ZIP, so the Daily brings that town's bids. */
      if (!/^\d{5}$/.test(zv) && /^\d{5}$/.test(el.getAttribute('data-zip') || '')) zv = el.getAttribute('data-zip');
      subscribe({ email: email, source: source, reports: reports, zip: /^\d{5}$/.test(zv) ? zv : '' }).then(function (res) {
        el.removeAttribute('data-sa-busy');
        if (res.ok) {
          el.setAttribute('data-sa-done', '1');
          el.innerHTML = '<p class="sa-ok" tabindex="-1">' + esc(okText()) + '</p>';
          var ok = el.querySelector('.sa-ok'); try { ok.focus({ preventScroll: true }); } catch (x) { ok.focus(); }
          return;
        }
        btn.disabled = false; btn.textContent = BTN;
        msg.textContent = errText(res);
        if (res.status >= 400 && res.status < 500) { input.setAttribute('aria-invalid', 'true'); }
        input.focus();
      });
    });
  }
  function scan() { Array.prototype.forEach.call(document.querySelectorAll('[data-signup-ask]'), mount); }

  /* Once the reader signs up anywhere on the page, every other ask goes. */
  function hideOthers() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-signup-ask],[data-signup-hide]'), function (el) {
      if (el.getAttribute('data-sa-done') || el.getAttribute('data-sa-busy')) return;
      el.hidden = true;
    });
    var bar = document.getElementById('sa-bar');
    if (bar && !bar.querySelector('[data-sa-done],[data-sa-busy]')) closeBar(false);
    else if (bar) setTimeout(function () { closeBar(false); }, 5000);
  }
  window.addEventListener('agsist:signed-up', hideOthers);

  /* ---------- the second-visit bar ---------- */
  var barEl = null, barTimer = 0;
  function closeBar(snooze) {
    if (!barEl) return;
    if (snooze) setDismissed(BAR_KEY);
    var had = barEl.contains(document.activeElement);
    var b = barEl; barEl = null;
    b.classList.add('is-off');
    document.body.classList.remove('agsb-open', 'sa-bar-open');
    document.body.style.paddingBottom = '';
    window.removeEventListener('scroll', placeBar); window.removeEventListener('resize', placeBar);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
    if (had) { var m = document.getElementById('main') || document.querySelector('main'); if (m) { if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1'); try { m.focus({ preventScroll: true }); } catch (e) {} } }
  }
  /* Phone: the bar never sits over the hero. It shows only while the hero's
     bottom is above the bar's top; on a page without a hero, once the reader
     has scrolled a little. Desktop: it shows at once, below everything. */
  function placeBar() {
    if (!barEl) return;
    cancelAnimationFrame(barTimer);
    barTimer = requestAnimationFrame(function () {
      if (!barEl) return;
      var phone = window.innerWidth < 640, show = true;
      var h = barEl.offsetHeight || 0;
      var hero = document.getElementById('hero-band');
      if (hero && hero.offsetParent !== null) {
        var r = hero.getBoundingClientRect();
        show = r.bottom <= window.innerHeight - h || r.bottom < 0;
      } else if (phone) {
        show = (window.scrollY || document.documentElement.scrollTop || 0) > 120;
      }
      if (barEl.contains(document.activeElement) || barEl.getAttribute('data-sa-busy')) show = true;
      barEl.classList.toggle('is-off', !show);
      barEl.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (!show) barEl.setAttribute('inert', ''); else barEl.removeAttribute('inert');
      document.body.style.paddingBottom = show ? h + 'px' : '';
    });
  }
  function bar() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    if (/^\/(daily|field-scout)(\.html)?$/.test(p)) return;
    if (isSignedUp() || visits() < 2 || isDismissed(BAR_KEY)) return;
    try { if (Date.now() < +(localStorage.getItem('agsist_bar_snooze') || 0)) return; } catch (e) {}
    if (document.getElementById('sa-bar')) return;
    css();
    var b = document.createElement('aside');
    b.id = 'sa-bar'; b.className = 'sa-bar is-off';
    b.setAttribute('aria-label', 'AGSIST Daily signup');
    b.innerHTML = '<div class="sa-bar-in"><div data-signup-ask="' + esc(BAR_TEXT) + '" data-source="bar" data-variant="bar"></div>'
      + '<button type="button" class="sa-x" aria-label="Close the AGSIST Daily signup">✕</button></div>';
    document.body.appendChild(b);
    barEl = b;
    mount(b.querySelector('[data-signup-ask]'));
    var ask = b.querySelector('.sa-ask'); if (ask) ask.removeAttribute('data-signup-hide');
    b.querySelector('.sa-x').addEventListener('click', function () { closeBar(true); });
    b.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBar(false); });
    b.addEventListener('submit', function () { b.setAttribute('data-sa-busy', '1'); setTimeout(function () { b.removeAttribute('data-sa-busy'); }, 8000); }, true);
    document.body.classList.add('agsb-open', 'sa-bar-open');   // agsb-open: /breakeven hides its own bottom bar
    window.addEventListener('scroll', placeBar, { passive: true });
    window.addEventListener('resize', placeBar);
    /* The hero grows as its figures load; re-check when the page reflows. */
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(placeBar), hb = document.getElementById('hero-band');
      ro.observe(document.body); if (hb) ro.observe(hb);
    }
    track('signup_bar_shown', { page: p });
    requestAnimationFrame(function () { requestAnimationFrame(placeBar); });
  }

  window.AgsistSignup = {
    _v: 1,
    isSignedUp: isSignedUp, setSignedUp: setSignedUp,
    isDismissed: isDismissed, setDismissed: setDismissed,
    zip: zip, subscribe: subscribe, okText: okText, errText: errText,
    source: sourceFor, mount: mount, scan: scan, css: css
  };

  countVisit();
  scan();
  function ready() {
    scan();
    if (document.querySelector('[data-signup-hide]')) css();
    if (isSignedUp()) Array.prototype.forEach.call(document.querySelectorAll('[data-signup-hide]'), function (el) { el.hidden = true; });
    bar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
