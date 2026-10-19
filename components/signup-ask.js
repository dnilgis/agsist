/* AGSIST Daily signup asks: one component for every ask on the site.
   2026-10-06.

   Markup, CSS and logic live here and nowhere else. A page asks with one
   tag:

     <div data-signup-ask="Email me the best bids near me every morning"
          data-source="page:cash-bids"></div>

   Optional: data-variant="hero" (the homepage hero line), data-reports="0",
   data-note="..." (one quiet line under the field).
   Without data-source the source is "page:<slug of this path>".

   Every AGSIST Daily ask carries an optional ZIP box ("ZIP, for your top
   local bid in the email"), filled from the page's own ZIP (data-zip-input,
   data-zip) or the saved location. Page asks show it at once; the hero line
   and the bar open it when the email box gets focus. Left blank, no ZIP is
   sent. (2026-10-11)

   One-time notices, not the Daily (worker v5.11, POST /notice):
     <div data-signup-ask="Email me when the 2027 county rents for Iowa come out."
          data-topic="rent:ia" data-ok="..."></div>
     <div data-signup-ask data-deadlines="2026-12-11 2027-03-15"></div>
   data-deadlines lists signup deadlines; the ask offers a reminder a week
   before the first one that is still more than a week off, and hides when
   none is. A notice ask shows to Daily readers too, hides once that notice
   is asked for in this browser (agsist_notices), and enrolls nobody in the
   Daily unless "Also send the morning briefing" is ticked.
   That box always starts empty and its ZIP box opens when it is ticked
   (Sig, 2026-10-19: no ask ever pre-ticks the Daily; data-daily is ignored).
   data-after="YYYY-II" goes with a recurring notice (prf:<grid>): the
   newest interval already out, so the first email is the next one.

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
  var EP_NOTICE = 'https://agsist-subs.dnilgis.workers.dev/notice';
  var NOTICE_KEY = 'agsist_notices';
  var ZIP_LABEL = 'ZIP, for your top local bid in the email';
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
  /* One-time notices asked for in this browser: {topic: ms}. */
  function notices() { try { var o = JSON.parse(localStorage.getItem(NOTICE_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function noticeDone(t) { return !!notices()[t]; }
  function setNoticeDone(t) { try { var o = notices(); o[t] = Date.now(); localStorage.setItem(NOTICE_KEY, JSON.stringify(o)); } catch (e) {} }
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
  /* o.zipField: the reader saw a ZIP box, so send what is in it and nothing
     else (blank means no ZIP). Without it, the saved location fills in. */
  function subscribe(o) {
    o = o || {};
    var body = { email: String(o.email || '').trim(), source: sourceFor(o.source), reports: o.reports !== false };
    var z = /^\d{5}$/.test(String(o.zip || '')) ? String(o.zip) : (o.zipField ? '' : zip());
    if (z) body.zip = z;
    return post(EP, body).then(function (res) {
      if (res.ok) signedUp(body.source);
      return res;
    });
  }
  function signedUp(source) {
    setSignedUp();
    track('email_signup', { source: source });
    try { window.dispatchEvent(new CustomEvent('agsist:signed-up', { detail: { source: source } })); } catch (e) {}
  }
  /* POST /notice: a one-time notice; daily:true also joins the Daily. */
  function notice(o) {
    var body = { email: String(o.email || '').trim(), source: String(o.source || '').slice(0, 60), topic: o.topic, daily: !!o.daily };
    if (o.daily) { body.reports = true; if (/^\d{5}$/.test(String(o.zip || ''))) body.zip = String(o.zip); }
    /* a recurring notice (prf:<grid>, worker v5.29): the newest one already out, so the first email is the next */
    if (/^\d{4}-\d{2}$/.test(String(o.after || ''))) body.after = String(o.after);
    return post(EP_NOTICE, body).then(function (res) {
      if (res.ok) {
        setNoticeDone(o.topic);
        track('notice_signup', { topic: o.topic, source: body.source });
        if (o.daily) signedUp(body.source);
      }
      return res;
    });
  }
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        return { ok: !!(r.ok && d && d.ok === true), status: r.status, data: d };
      });
    }, function () { return { ok: false, status: 0, data: null }; });
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
    /* the optional ZIP box and the notice asks' daily box: one row each, under the field */
    '.sa-z{grid-column:1/-1;display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin:2px 0 0}',
    '.sa-z[hidden],.sa-d[hidden]{display:none!important}',
    '.sa-zl{font-size:.875rem;line-height:1.35;color:var(--text-muted)}',
    '.sa-zin{flex:none;width:7.5rem;box-sizing:border-box;min-height:44px;padding:.5rem .7rem;font:inherit;font-size:1rem;color:var(--text);background:var(--surface,#fff);border:1px solid var(--border-2,var(--border));border-radius:6px}',
    '.sa-zin::placeholder{color:var(--text-muted);opacity:1}',
    '.sa-zin:focus{outline:2px solid var(--gold);outline-offset:1px;border-color:var(--gold)}',
    '.sa-zin[aria-invalid="true"]{border-color:var(--red)}',
    '.sa-d{grid-column:1/-1;min-height:44px;padding:2px 0;align-items:center}',
    '.sa-n{grid-column:1/-1;margin:0;font-size:.8125rem;line-height:1.4;color:var(--text-muted)}',
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
    '  .sa-ask--hero .sa-z{grid-row:2;margin-top:6px}',
    '  .sa-bar .sa-zl{font-size:.8125rem}',
    '  .sa-bar .sa-zin{min-height:42px}',
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

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function md(d) { return MON[d.getMonth()] + ' ' + d.getDate(); }
  /* data-deadlines: the first deadline whose reminder day (a week before) is
     still ahead. Dates come from the page, which build_arc_plc.py writes
     from its own signup dates. */
  function arcplc(el) {
    var ds = String(el.getAttribute('data-deadlines') || '').split(/\s+/), now = Date.now();
    for (var i = 0; i < ds.length; i++) {
      var d = day(ds[i]); if (!d) continue;
      var r = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7);
      if (r.getTime() > now) return { topic: 'arcplc:' + ds[i],
        copy: 'Remind me a week before the ' + md(d) + ' signup deadline.',
        ok: 'Done. I’ll email you on ' + md(r) + ', a week before the ' + md(d) + ' deadline.', btn: 'Remind me' };
    }
    return null;
  }
  /* The ZIP to start the box with: the page's own ZIP box, a town page's ZIP, the saved location. */
  function zipStart(el) {
    var zi = el.getAttribute('data-zip-input'), n = zi && document.getElementById(zi);
    var v = n ? String(n.value || '').trim() : '';
    if (/^\d{5}$/.test(v)) return v;
    if (/^\d{5}$/.test(el.getAttribute('data-zip') || '')) return el.getAttribute('data-zip');
    return zip();
  }

  function mount(el) {
    if (!el || el.getAttribute('data-sa-ready')) return;
    el.setAttribute('data-sa-ready', '1');
    var arc = el.hasAttribute('data-deadlines') ? arcplc(el) : null;
    if (el.hasAttribute('data-deadlines') && !arc) { el.hidden = true; return; }
    var topic = arc ? arc.topic : (el.getAttribute('data-topic') || '');
    if (topic) {
      el.setAttribute('data-sa-topic', topic);
      if (noticeDone(topic)) { el.hidden = true; return; }
    } else if (isSignedUp()) { el.hidden = true; return; }
    css();
    var copy = arc ? arc.copy : (el.getAttribute('data-signup-ask') || BAR_TEXT);
    var variant = el.getAttribute('data-variant') || 'page';
    var source = el.getAttribute('data-source') || ('page:' + slug());
    var reports = el.getAttribute('data-reports') !== '0';
    var note = el.getAttribute('data-note') || '';
    var BTN = topic ? (arc ? arc.btn : (el.getAttribute('data-btn') || 'Email me')) : (variant === 'hero' ? 'Sign up' : 'Sign up free');
    var OK = topic ? (arc ? arc.ok : (el.getAttribute('data-ok') || 'Done. One email when it’s out.')) : okText();
    var withDaily = topic && !isSignedUp();
    var n = ++seq, iid = 'sa-e-' + n, mid = 'sa-m-' + n, zid = 'sa-z-' + n, did = 'sa-d-' + n;
    /* the ZIP box: a Daily ask always has one; a notice ask only with the Daily box ticked */
    var zipLater = topic ? true : (variant === 'hero' || variant === 'bar');
    el.classList.add('sa-ask', 'sa-ask--' + variant);
    el.innerHTML = '<form class="sa-f" novalidate>'
      + (variant === 'hero' ? '<span class="sa-box">' : '')
      + '<label class="sa-l" for="' + iid + '">' + esc(copy) + '</label>'
      + '<input class="sa-in" id="' + iid + '" type="email" name="email" autocomplete="email" inputmode="email" placeholder="your@email.com" required aria-describedby="' + mid + '">'
      + (variant === 'hero' ? '</span>' : '')
      + '<button class="sa-b" type="submit">' + esc(BTN) + '</button>'
      + (withDaily ? '<label class="sa-optin sa-d" for="' + did + '"><input type="checkbox" id="' + did + '"> Also send the morning briefing</label>' : '')
      + (topic && !withDaily ? '' : '<div class="sa-z"' + (zipLater ? ' hidden' : '') + '><label class="sa-zl" for="' + zid + '">' + ZIP_LABEL + '</label>'
        + '<input class="sa-zin" id="' + zid + '" type="text" name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="5" placeholder="Optional"></div>')
      + '<p class="sa-m" id="' + mid + '" role="status" aria-live="polite"></p>'
      + (note ? '<p class="sa-n">' + esc(note) + '</p>' : '')
      + '</form>';
    el.hidden = false;
    var form = el.querySelector('form'), input = el.querySelector('.sa-in'), btn = el.querySelector('.sa-b'), msg = el.querySelector('.sa-m');
    var zrow = el.querySelector('.sa-z'), zin = el.querySelector('.sa-zin'), dbox = el.querySelector('.sa-d input');
    var zipTouched = false;
    function fillZip() { if (zin && !zipTouched) zin.value = zipStart(el); }
    function showZip(on) {
      if (!zrow || zrow.hidden === !on) return;
      zrow.hidden = !on; if (on) fillZip();
      if (barEl && barEl.contains(el)) placeBar();
    }
    fillZip();
    if (zin) {
      zin.addEventListener('input', function () { zipTouched = true; zin.removeAttribute('aria-invalid'); zin.value = zin.value.replace(/\D/g, '').slice(0, 5); });
    }
    /* the page's own ZIP box may have been filled since the ask was drawn */
    input.addEventListener('focus', function () { if (zrow && zrow.hidden && !topic) showZip(true); else fillZip(); });
    if (dbox) dbox.addEventListener('change', function () { showZip(dbox.checked); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (input.value || '').trim();
      if (!EMAIL_RE.test(email)) {
        msg.textContent = 'Enter a real email address.';
        input.setAttribute('aria-invalid', 'true'); input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      var zipShown = !!(zrow && !zrow.hidden), zv = zipShown ? String(zin.value || '').trim() : '';
      if (zv && !/^\d{5}$/.test(zv)) {
        msg.textContent = 'A ZIP is 5 digits. Fix it, or leave it blank.';
        zin.setAttribute('aria-invalid', 'true'); zin.focus();
        return;
      }
      msg.textContent = '';
      btn.disabled = true; btn.textContent = 'Sending…';
      el.setAttribute('data-sa-busy', '1');
      var daily = !!(dbox && dbox.checked);
      var req;
      if (topic) req = notice({ email: email, source: source, topic: topic, daily: daily, zip: zv, after: el.getAttribute('data-after') || '' });
      else if (zipShown) req = subscribe({ email: email, source: source, reports: reports, zip: zv, zipField: true });
      else req = subscribe({ email: email, source: source, reports: reports, zip: zipStart(el) });
      req.then(function (res) {
        el.removeAttribute('data-sa-busy');
        if (res.ok) {
          el.setAttribute('data-sa-done', '1');
          el.innerHTML = '<p class="sa-ok" tabindex="-1">' + esc(OK + (topic && daily ? ' The morning briefing starts tomorrow.' : '')) + '</p>';
          var ok = el.querySelector('.sa-ok'); try { ok.focus({ preventScroll: true }); } catch (x) { ok.focus(); }
          return;
        }
        btn.disabled = false; btn.textContent = BTN;
        msg.textContent = errText(res);
        if (res.status >= 400 && res.status < 500 && /email/i.test(String(res.data && res.data.error || ''))) { input.setAttribute('aria-invalid', 'true'); }
        input.focus();
      });
    });
  }
  function scan() { Array.prototype.forEach.call(document.querySelectorAll('[data-signup-ask]'), mount); }

  /* Once the reader signs up anywhere on the page, every other ask goes. */
  function hideOthers() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-signup-ask],[data-signup-hide]'), function (el) {
      if (el.getAttribute('data-sa-done') || el.getAttribute('data-sa-busy')) return;
      /* a notice ask is its own list: it stays, without its Daily box */
      if (el.getAttribute('data-sa-topic')) {
        var d = el.querySelector('.sa-d'), z = el.querySelector('.sa-z');
        if (d) { d.hidden = true; d.querySelector('input').checked = false; }
        if (z) z.hidden = true;
        return;
      }
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
    /* No sticky bar where it covers the work or is the wrong ask: the briefing
       and its archive (/daily/2026-10-11), the field tools and print sheets,
       the sponsor pages, the store-or-sell worksheet (2026-10-11), and /prf, which says it takes no
       contact details (2026-10-12). */
    if (/^\/(daily|field-scout|rain-print|sponsor|sponsor-kit|sponsor-apply|sponsor-report|store-or-sell|prf)(\.html)?$/.test(p)
        || /^\/daily\/[^/]+$/.test(p)) return;
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
    zip: zip, subscribe: subscribe, notice: notice, okText: okText, errText: errText,
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
