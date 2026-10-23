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

   Two standing lists on the same route (worker v5.44, Sig Oct 21), each its
   own list, never the Daily unless the reader ticks the box:
     data-topic="reports"  the report-day email alone, the WASDE summary
                           (scripts/send_report_day.py), source
                           report:wasde:<page>;
     data-topic="cot"      Funds this week, one email after each COT release
                           (scripts/send_cot_weekly.py), source
                           cot-weekly:<page>.
   They count as the page's own ask (no bar), and GA4 gets notice_signup
   {topic, source, ask_id} like every notice ask.

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

  var EP = 'https://agsist-api.dnilgis.workers.dev/subscribe';
  var EP_NOTICE = 'https://agsist-api.dnilgis.workers.dev/notice';
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

  /* ---------- flags ----------
     Signed up (2026-10-20, Sig): the Daily asks come back after a year. The
     cookie lasts 365 days; localStorage keeps agsist_subscribed = '1' (the
     inline head checks on the cash bid and futures pages read that) and
     agsist_subscribed_at = when. A flag with no date (set before this, or by
     an older copy of the setter) starts its year the first time it is read
     here. Past a year both are cleared and the asks show again. */
  var SIGNED_DAYS = 365, SIGNED_AT = 'agsist_subscribed_at';
  function hasCookie() { try { return /(^|;\s*)agsist_subscribed=/.test(document.cookie); } catch (e) { return false; } }
  function isSignedUp() {
    var ck = hasCookie(), ls = false, at = 0;
    try { ls = localStorage.getItem('agsist_subscribed') === '1'; at = parseInt(localStorage.getItem(SIGNED_AT), 10) || 0; }
    catch (e) { return ck; }
    if (!ck && !ls) return false;
    if (!at) { try { localStorage.setItem(SIGNED_AT, String(Date.now())); } catch (e) {} return true; }
    if (Date.now() - at < SIGNED_DAYS * 864e5) return true;
    clearSignedUp();
    return false;
  }
  function setSignedUp() {
    try {
      var exp = new Date(Date.now() + SIGNED_DAYS * 864e5);
      document.cookie = 'agsist_subscribed=1;expires=' + exp.toUTCString() + ';path=/;SameSite=Lax';
    } catch (e) {}
    try { localStorage.setItem('agsist_subscribed', '1'); localStorage.setItem(SIGNED_AT, String(Date.now())); } catch (e) {}
  }
  function clearSignedUp() {
    try { document.cookie = 'agsist_subscribed=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax'; } catch (e) {}
    try { localStorage.removeItem('agsist_subscribed'); localStorage.removeItem(SIGNED_AT); } catch (e) {}
  }
  /* One-time notices asked for in this browser: {key: ms}.
     A rent notice is one release a year (2026-10-20): the worker keeps topic
     rent:<st>, and this browser remembers rent:<st>:<release year>, so the
     next year's ask shows again. An older rent:<st> entry counts for the
     release that was next when it was made. */
  function notices() { try { var o = JSON.parse(localStorage.getItem(NOTICE_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  /* The county rent release a notice made at time t waits for: NASS puts
     them out in late August, so from September on it is next year's. */
  function rentYear(t) { var d = new Date(t || Date.now()); return d.getFullYear() + (d.getMonth() >= 8 ? 1 : 0); }
  function noticeKey(t, year) {
    var m = /^rent:([a-z]{2})$/.exec(String(t || ''));
    return m ? t + ':' + (year || rentYear()) : t;
  }
  function noticeDone(t, year) {
    var o = notices(), k = noticeKey(t, year);
    if (o[k]) return true;
    if (k !== t && o[t]) return rentYear(o[t]) === +k.slice(t.length + 1);
    return false;
  }
  function setNoticeDone(t, year) { try { var o = notices(); o[noticeKey(t, year)] = Date.now(); localStorage.setItem(NOTICE_KEY, JSON.stringify(o)); } catch (e) {} }
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
      if (res.ok) signedUp(body.source, o.askId);
      return res;
    });
  }
  function signedUp(source, askId) {
    setSignedUp();
    track('email_signup', { source: source, ask_id: askId || source });
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
        setNoticeDone(o.topic, o.year);
        track('notice_signup', { topic: o.topic, source: body.source, ask_id: o.askId || body.source });
        if (o.daily) signedUp(body.source, o.askId);
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
  /* The worker was blocked and loader.js kept the signup on the backup form:
     {ok:true, queued:true, message}. The plain line to show, or ''. */
  function queued(res) { return res && res.data && res.data.queued === true ? String(res.data.message || "Got it. You'll be added within a day.") : ''; }
  function errText(res) {
    if (!res || res.status === 0) return 'Could not reach the signup service. Check your connection and try again.';
    var e = res.data && res.data.error ? String(res.data.error) : '';
    if (res.status >= 400 && res.status < 500 && /email/i.test(e)) return 'That email address was not accepted. Check it and try again.';
    return 'That did not go through' + (res.ok || res.status < 400 ? '' : ' (error ' + res.status + ')')
      + '. Nothing was saved. Try again, or email sig@agsist.com and I will add you by hand.';
  }

  /* ---------- CSS ---------- */
  var CSS = [
    '.sa-ask{font-family:var(--font-body,Inter,system-ui,sans-serif);color:var(--text);margin:14px 0}',
    '.sa-ask[hidden],.sa-bar[hidden],[data-signup-hide][hidden]{display:none!important}',
    /* styles.css hides every ask for a Daily reader before first paint (html.sa-subbed, set by the
       futures and cash bid pages' head script). A notice or list ask is not the Daily: once drawn it
       shows (2026-10-21; same weight as that rule, and this sheet comes later). */
    'html.sa-subbed [data-signup-ask][data-topic][data-sa-ready]{display:block}',
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
    /* "One more?" after a signup: one quiet box under the thanks line */
    '.sa-more{margin:10px 0 0;padding:10px 12px;font-family:var(--font-body,Inter,system-ui,sans-serif);color:var(--text);text-align:left;background:var(--surface2,var(--surface));border:1px solid var(--border-2,var(--border));border-radius:8px}',
    '.sa-more[hidden]{display:none!important}',
    '.sa-mh{margin:0 0 2px;font-size:.9375rem;font-weight:700;line-height:1.35;color:var(--text)}',
    '.sa-mf{display:flex;flex-direction:column;align-items:stretch;gap:0;margin:0}',
    '.sa-mo span{min-width:0}',
    '.sa-mo[data-k="zip"]{align-items:center}',
    '.sa-mo label{cursor:pointer}',
    '.sa-mc,.sa-mp,.sa-mz{min-height:36px;margin:0 2px;padding:.25rem .4rem;font:inherit;font-size:.9375rem;color:var(--text);background:var(--surface,#fff);border:1px solid var(--border-2,var(--border));border-radius:6px;vertical-align:middle}',
    '.sa-optin .sa-mp,.sa-optin .sa-mz{flex:none;width:5.5rem;height:auto;box-sizing:border-box;margin:0 2px;cursor:text;accent-color:auto}',
    '.sa-mp[aria-invalid="true"],.sa-mz[aria-invalid="true"]{border-color:var(--red)}',
    '.sa-mzl{display:inline-flex;align-items:center;gap:4px;margin-top:4px;font-size:.875rem;color:var(--text-muted);white-space:nowrap}',
    '@media (min-width:640px){.sa-mo[data-k="daily"]{align-items:center}.sa-mzl{margin:0 0 0 6px}}',
    '.sa-mf .sa-b{align-self:flex-start;margin-top:6px}',
    '.sa-mf .sa-m{margin-top:4px}',
    '.sa-bar .sa-more{margin:6px 0 2px;max-height:60vh;overflow:auto}',
    '@media print{.sa-bar,.sa-ask,.sa-more{display:none!important}}'
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
    var copy = arc ? arc.copy : (el.getAttribute('data-signup-ask') || BAR_TEXT);
    /* a rent ask names the release it is for ("the 2027 county rents") */
    var year = 0;
    if (/^rent:/.test(topic)) { var ym = /\b(20\d\d)\b/.exec(copy); year = ym ? +ym[1] : rentYear(); }
    if (topic) {
      el.setAttribute('data-sa-topic', topic);
      if (noticeDone(topic, year)) { el.hidden = true; return; }
    } else if (isSignedUp()) { el.hidden = true; return; }
    css();
    var variant = el.getAttribute('data-variant') || 'page';
    var source = el.getAttribute('data-source') || ('page:' + slug());
    var askId = askIdOf(source, topic);
    el.setAttribute('data-sa-id', askId);
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
    seen(el, askId);
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
      var zipUsed = zipShown ? zv : zipStart(el);
      if (topic) req = notice({ email: email, source: source, topic: topic, daily: daily, zip: zv, year: year, askId: askId, after: el.getAttribute('data-after') || '' });
      else if (zipShown) req = subscribe({ email: email, source: source, reports: reports, zip: zv, zipField: true, askId: askId });
      else req = subscribe({ email: email, source: source, reports: reports, zip: zipUsed, askId: askId });
      req.then(function (res) {
        el.removeAttribute('data-sa-busy');
        if (res.ok) {
          el.setAttribute('data-sa-done', '1');
          // queued (2026-10-22): the worker was blocked and the signup went to the backup form (loader.js)
          el.innerHTML = '<p class="sa-ok" tabindex="-1">' + esc(queued(res) || OK + (topic && daily ? ' The morning briefing starts tomorrow.' : '')) + '</p>';
          var ok = el.querySelector('.sa-ok'); try { ok.focus({ preventScroll: true }); } catch (x) { ok.focus(); }
          oneMore(el, { gave: topic ? 'notice' : 'daily', topic: topic, email: email, zip: zipUsed || (topic ? zipStart(el) : ''), reports: topic ? true : reports });
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
    else if (bar) setTimeout(function () { if (!bar.querySelector('[data-sa-more]')) closeBar(false); }, 5000);
  }
  window.addEventListener('agsist:signed-up', hideOthers);

  /* ---------- ask_shown / ask_dismissed (2026-10-20) ----------
     One ask_shown per ask per page view, once half of it is on screen. The
     ask_id is the ask's source, plus the notice kind on a notice ask
     ("page:rent/iowa|rent"); email_signup and notice_signup carry the same
     ask_id, so each ask's rate is its signups over its ask_shown. */
  function askIdOf(source, topic) {
    var k = String(topic || '').split(':')[0];
    return (String(source || '') + (k ? '|' + k : '')).slice(0, 80);
  }
  var seenIds = {}, io = null;
  function shown(id) { if (!id || seenIds[id]) return; seenIds[id] = 1; track('ask_shown', { ask_id: id }); }
  function seen(el, id) {
    if (!el || !id || el.getAttribute('data-sa-seen')) return;
    el.setAttribute('data-sa-seen', '1');
    if (!el.getAttribute('data-sa-id')) el.setAttribute('data-sa-id', id);
    if (!('IntersectionObserver' in window)) { shown(id); return; }
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        shown(e.target.getAttribute('data-sa-id'));
      });
    }, { threshold: 0.5 });
    io.observe(el);
  }
  function dismissed(id, how) { track('ask_dismissed', { ask_id: id, how: how }); }

  /* ---------- "One more?" (2026-10-20, Sig) ----------
     After any signup that went through, one quiet panel in the same place
     offers up to three more emails that fit what the reader gave. Each is an
     unticked box; one button, "Add these". Only topics with a sender:
       daily     AGSIST Daily (scripts/send_daily.py), when not on it yet;
       zip       a cash price alert within 25 mi of their ZIP, double opt-in
                 (POST /elevator-watch-subscribe, scripts/send_zip_alert.py),
                 the body components/cb-signup.js sends;
       rainyear  their county's full-year rain total, one email in January
                 (after a monthly county rain signup too, rain-month:<fips>)
                 (rainyear:<year>:<fips>, scripts/send_rain_year.py), when
                 data/rain has the county and its year is still going;
       rent      their state's next county cash rent release (rent:<st>,
                 scripts/send_rent_notice.py), for the states with a /rent page.
     The ZIP is the one they typed, the page's, or the saved one. The county
     comes only from the page or the topic; the state from those, the page
     address, or the ZIP's first three digits. Never geolocation. Nothing
     shows when nothing fits. GA4: onemore_shown and onemore_added with the
     topics, never the address. */
  var WORKER = 'https://agsist-api.dnilgis.workers.dev';
  var ST_NAMES = {};
  ('AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming')
    .split('|').forEach(function (s) { ST_NAMES[s.slice(0, 2)] = s.slice(3); });
  /* County FIPS state codes (components/place.js FIPS_ST) */
  var FIPS_ST = {};
  ('01AL 02AK 04AZ 05AR 06CA 08CO 09CT 10DE 12FL 13GA 15HI 16ID 17IL 18IN 19IA 20KS 21KY 22LA 23ME 24MD 25MA 26MI 27MN 28MS 29MO 30MT 31NE 32NV 33NH 34NJ 35NM 36NY 37NC 38ND 39OH 40OK 41OR 42PA 44RI 45SC 46SD 47TN 48TX 49UT 50VT 51VA 53WA 54WV 55WI 56WY')
    .split(' ').forEach(function (s) { FIPS_ST[s.slice(0, 2)] = s.slice(2); });
  /* ZIP prefix to state: the same table as components/price-local.js and cb-vs-state.js */
  var Z3 = '005NY006--010MA028RI030NH039ME050VT055MA056VT060CT070NJ090--100NY150PA197DE200DC201VA202DC206MD220VA247WV270NC290SC300GA320FL340--341FL350AL370TN386MS398GA400KY430OH460IN480MI500IA530WI550MN569DC570SD580ND590MT600IL630MO660KS680NE700LA716AR730OK733TX734OK750TX800CO820WY832ID840UT850AZ870NM885TX889NV900CA962--967HI969--970OR980WA995AK';
  function zipState(z) {
    if (!/^\d{5}$/.test(z || '')) return '';
    var p = +z.slice(0, 3), st = '';
    for (var i = 0; i < Z3.length; i += 5) { if (+Z3.substr(i, 3) > p) break; st = Z3.substr(i + 3, 2); }
    return ST_NAMES[st] ? st : '';
  }
  /* The states with a /rent/<state> page (data/cash-rent/<ST>.json) */
  var RENT_ST = 'AL AR AZ CA CO CT DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA SC SD TN TX UT VA VT WA WI WV WY'.split(' ');
  /* The worker's RAIN_ST_FIPS (rainyear topics it takes) */
  var RAIN_FIPS = '01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56'.split(' ');
  function stSlug(st) { return String(ST_NAMES[st] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  function pathState() {
    var m = /^\/(rent|rain|arc-plc|farmland-atlas|cash-bids|prf)\/([a-z-]+?)(\/|\.html$|$)/.exec(location.pathname);
    if (!m) return '';
    for (var k in ST_NAMES) if (stSlug(k) === m[2]) return k;
    return '';
  }
  /* The ZIP cash alert body: byte for byte components/cb-signup.js widFor()
     and alertBody() (test/one-more.test.mjs checks it). */
  var MILES = 25;
  function widFor(a, b, c, d) {
    var s = [a, b, c, d].map(function (x) { return String(x || '').trim().toUpperCase(); }).join('|');
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function money(c) { return '$' + (c / 100).toFixed(2); }
  function alertBody(email, zip, crop, cents) {
    var ewid = 'ab' + zip + ('00' + MILES).slice(-3);
    return { email: email, kind: 'cash', ewid: ewid, crop: crop, period: 'nearby', plabel: 'nearest delivery',
      direction: 'above', target_cents: cents,
      label: (crop.charAt(0).toUpperCase() + crop.slice(1) + ' at or above ' + money(cents) + ' within ' + MILES + ' mi of ZIP ' + zip).slice(0, 120),
      wid: widFor(ewid, 'cash', 'nearby', 'above:' + cents) };
  }
  /* The county's rain year, if the January email can be had for it */
  function rainOffer(fips) {
    var st = FIPS_ST[String(fips || '').slice(0, 2)];
    if (!/^\d{5}$/.test(fips || '') || !st || RAIN_FIPS.indexOf(fips.slice(0, 2)) < 0 || fips.slice(2) === '000' || !window.fetch) return Promise.resolve(null);
    return fetch('/data/rain/' + st.toLowerCase() + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) {
        var c = d && d.counties && d.counties[fips], y = new Date().getUTCFullYear();
        if (!c || !c.name || d.year !== y || /-12-31$/.test(String(d.edate || ''))) return null;
        return { topic: 'rainyear:' + y + ':' + fips, name: c.name, year: y };
      });
  }
  /* 2026-10-20 (Sig), "One more?" after the alert signups too, and the extras
     that fit the page after a Daily signup:
       hail      a hail alert, 10 mi around the spot (POST /alert-subscribe,
                 scripts/check_alerts.py), on hail and rain pages: the hail
                 map's last spot (window.AGSIST_HAIL_SPOT) or their ZIP's
                 center (the bids network's data/zips, as cb-alerts.js);
       price     a futures price alert, double opt-in (POST
                 /price-watch-subscribe, scripts/send_price_watch.py), the
                 body index.html sends, on the futures and report pages;
       reports   the "USDA vs the trade" report-day emails
                 (scripts/send_report_day.py), on report and futures pages,
                 only when the Daily was just taken without them (the menu
                 asks send reports:false). A Daily signup anywhere else
                 already gets them, so it is never offered there.
     2026-10-21 (Sig), the two standing lists (worker v5.44, POST /notice):
       wasde     the WASDE summary alone (topic reports, the same email),
                 on report and futures pages, after a notice or alert signup
                 by a reader not on the Daily (a Daily reader already gets it);
       cot       Funds this week (topic cot, scripts/send_cot_weekly.py), on
                 /cot, /markets and the futures and cattle pages.
     After a hail alert, the Daily row carries an optional ZIP box filled
     from the ZIP they searched, else the ZIP nearest the spot (agsist's
     data/zip-grid.json picks the ZIP files, the bids network's data/zips
     gives the centers; nothing within 15 mi leaves it blank). Source tags
     onemore:<what they gave>, with onemore:hail-alert and
     onemore:elevator-watch for the hail alert and the elevator alerts. */
  var NET = 'https://dnilgis.github.io/bids/';
  var SRC_TAG = { hail: 'hail-alert', elevator: 'elevator-watch' };
  var HAIL_MI = 10;
  function getJ(u) { return window.fetch ? fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : Promise.resolve(null); }
  function miles(a, b, c, d) {
    var R = 3958.8, p = Math.PI / 180, x = (c - a) * p, y = (d - b) * p;
    var s = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) * Math.sin(y / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  var zipFiles = {};
  function zipFile(p2) { if (!zipFiles[p2]) zipFiles[p2] = getJ(NET + 'data/zips/' + p2 + '.json'); return zipFiles[p2]; }
  /* The ZIP whose center is nearest a point, within 15 mi; '' when unsure. */
  function zipNear(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon)) return Promise.resolve('');
    return getJ('/data/zip-grid.json').then(function (g) {
      if (!Array.isArray(g)) return '';
      var near = g.filter(function (x) { return x && /^\d{5}$/.test(x.zip) && isFinite(x.lat) && isFinite(x.lng); })
        .map(function (x) { return { p: x.zip.slice(0, 2), mi: miles(lat, lon, x.lat, x.lng) }; })
        .sort(function (a, b) { return a.mi - b.mi; }).slice(0, 6);
      var ps = []; near.forEach(function (x) { if (ps.indexOf(x.p) < 0 && ps.length < 3) ps.push(x.p); });
      return Promise.all(ps.map(zipFile)).then(function (ts) {
        var best = '', bm = 15;
        ts.forEach(function (t) {
          if (!t || typeof t !== 'object') return;
          for (var z in t) { var c = t[z]; if (!Array.isArray(c) || !/^\d{5}$/.test(z)) continue; var m = miles(lat, lon, +c[0], +c[1]); if (m < bm) { bm = m; best = z; } }
        });
        return best;
      });
    }).catch(function () { return ''; });
  }
  function zipCenter(z) {
    if (!/^\d{5}$/.test(z || '')) return Promise.resolve(null);
    return zipFile(z.slice(0, 2)).then(function (t) {
      var c = t && t[z], la = c && +c[0], lo = c && +c[1];
      return Array.isArray(c) && isFinite(la) && isFinite(lo) && !(la === 0 && lo === 0) ? { lat: la, lon: lo, label: 'ZIP ' + z } : null;
    });
  }
  /* What the page is about: hail and rain, a report, a futures price. */
  function pageKind() {
    var p = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    var fut = /^\/(corn|soybean|wheat|cattle)-futures-prices$/.exec(p);
    return {
      hail: /^\/(hail-map|hail|rain|rain-radar)(\/|$)/.test(p),
      report: /^\/(usda-calendar|whats-priced-in|cot|cot-tool|usda-quick-stats|markets|crop-tour)$/.test(p),
      futures: !!fut || /^\/(harvest-price-tracker|cattle-auction-prices)$/.test(p),
      cot: /^\/(cot|cot-tool|markets|cattle-auction-prices|(corn|soybean|wheat|cattle)-futures-prices)$/.test(p),
      sym: fut ? { corn: 'corn', soybean: 'beans', wheat: 'wheat', cattle: 'cattle' }[fut[1]] : (/^\/cattle-auction-prices$/.test(p) ? 'cattle' : 'corn')
    };
  }
  /* The futures alert body: the same as index.html's price alert (paId, PA_LABELS). */
  var PA_LABELS = { corn: 'Corn', beans: 'Soybeans', wheat: 'Chicago SRW wheat', cattle: 'Live Cattle' };
  function paId(symbol, direction, targetCents) {
    var s = (symbol + '|' + direction + '|' + targetCents).toUpperCase();
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function priceBody(email, symbol, direction, dollars) {
    var cents = Math.round(dollars * 100);
    return { email: email, pid: paId(symbol, direction, cents), symbol: symbol, direction: direction, target_cents: cents,
      label: PA_LABELS[symbol] + ' ' + (direction === 'above' ? 'above' : 'below') + ' $' + dollars.toFixed(2) };
  }
  var mseq = 0;
  /* host: the ask the reader just used. ctx: {gave: daily|notice|zip|price|county|hail|elevator,
     email, topic?, zip?, fips?, had?: [ids already asked for], after?: put the panel after this element,
     reports?: false when the Daily was just taken without report days, lat?, lon?: the spot they gave,
     place?: its name} */
  function oneMore(host, ctx) {
    ctx = ctx || {};
    var email = String(ctx.email || '').trim();
    if (!host || !EMAIL_RE.test(email) || host.querySelector('[data-sa-more]')) return;
    var gave = ctx.gave || 'daily', topic = String(ctx.topic || ''), had = ctx.had || [gave];
    var given = /^\d{5}$/.test(String(ctx.zip || '')) ? String(ctx.zip) : '';
    var spot = isFinite(ctx.lat) && isFinite(ctx.lon) && ctx.lat !== null && ctx.lon !== null ? { lat: +ctx.lat, lon: +ctx.lon, label: String(ctx.place || '') } : null;
    /* 2026-10-23: the monthly county rain ask (rain-month:<fips>, subs worker v5.54) names its county too */
    var fips = String(ctx.fips || (/^(?:rainyear:\d{4}|rain-month):(\d{5})$/.exec(topic) || [])[1] || '');
    var kind = pageKind();
    css();
    var box = document.createElement('div');
    box.className = 'sa-more'; box.setAttribute('data-sa-more', '1'); box.hidden = true;
    if (ctx.after && ctx.after.parentNode) ctx.after.parentNode.insertBefore(box, ctx.after.nextSibling);
    else host.appendChild(box);
    var source = 'onemore:' + (SRC_TAG[gave] || gave);
    /* a hail alert gives a spot, not a ZIP: the ZIP they searched, else the nearest one, else the saved one */
    var zipP = given ? Promise.resolve(given) : (spot ? zipNear(spot.lat, spot.lon) : Promise.resolve(''));
    zipP.then(function (zz) {
      var zipv = zz || (spot ? '' : zip());
      var st = ((/^rent:([a-z]{2})$/.exec(topic) || [])[1] || '').toUpperCase() || FIPS_ST[fips.slice(0, 2)] || pathState() || zipState(zipv || zip());
      var wantHail = kind.hail && had.indexOf('hail') < 0;
      var hs = wantHail && window.AGSIST_HAIL_SPOT, hailP = !wantHail ? Promise.resolve(null)
        : (hs && isFinite(hs.lat) && isFinite(hs.lon) ? Promise.resolve({ lat: +hs.lat, lon: +hs.lon, label: String(hs.label || 'the spot on the map') }) : zipCenter(zipv));
      return Promise.all([rainOffer(fips), hailP]).then(function (a) { build(zipv, st, a[0], a[1]); });
    });
    function build(zipv, st, rain, hspot) {
      var O = {};
      /* after a hail alert the Daily carries an optional ZIP box, filled when a ZIP is known */
      var dz = gave === 'hail';
      if (!isSignedUp() && had.indexOf('daily') < 0) O.daily = { label: esc('AGSIST Daily: the markets and your top local bid, free, every morning')
          + (dz ? '</label> <span class="sa-mzl">ZIP, optional <input class="sa-mz" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" value="' + esc(zipv) + '" aria-label="ZIP for your top local bid, optional"></span>' : ''),
        field: dz,
        send: function (f) { return subscribe(dz ? { email: email, source: source, zip: f.zip, zipField: true, askId: 'onemore' } : { email: email, source: source, zip: zipv, askId: 'onemore' }); },
        ok: 'You are on AGSIST Daily, first email tomorrow morning.' };
      if (zipv && had.indexOf('zip') < 0) O.zip = { field: 1, label: 'Tell me when</label> <select class="sa-mc" aria-label="Crop"><option value="corn">corn</option><option value="soybeans">soybeans</option><option value="wheat">wheat</option></select>'
          + ' within ' + MILES + ' mi of ZIP ' + zipv + ' pays $<input class="sa-mp" type="number" inputmode="decimal" step="0.01" min="1" max="32" aria-label="Price you want, dollars a bushel">',
        send: function (f) { return post(WORKER + '/elevator-watch-subscribe', alertBody(email, zipv, f.crop, f.cents)); },
        ok: 'Check your email to confirm the price alert. Nothing about it is sent until you press that link.' };
      if (rain && rain.topic !== topic && !noticeDone(rain.topic)) O.rainyear = { label: esc(rain.name + '’s full ' + rain.year + ' rain total, one email in January'),
        send: function () { return notice({ email: email, source: source, topic: rain.topic, daily: false, askId: 'onemore' }); },
        ok: 'One email in January with ' + rain.name + '’s ' + rain.year + ' rain total.' };
      var rt = st ? 'rent:' + st.toLowerCase() : '', ry = rentYear();
      if (rt && RENT_ST.indexOf(st) >= 0 && rt !== topic && !noticeDone(rt, ry)) O.rent = { label: esc('The ' + ry + ' ' + ST_NAMES[st] + ' county cash rents, one email when USDA puts them out (usually August)'),
        send: function () { return notice({ email: email, source: source, topic: rt, daily: false, year: ry, askId: 'onemore' }); },
        ok: 'One email when the ' + ry + ' ' + ST_NAMES[st] + ' county rents come out.' };
      if (hspot) O.hail = { label: esc('Hail alerts: an email the morning after radar-estimated hail touches within ' + HAIL_MI + ' mi of ' + hspot.label),
        send: function () { return post(WORKER + '/alert-subscribe', { email: email, lat: hspot.lat.toFixed(4), lon: hspot.lon.toFixed(4), place: hspot.label.slice(0, 120), radius_mi: HAIL_MI }); },
        ok: 'Watching ' + hspot.label + ', ' + HAIL_MI + ' mi radius. Alerts arrive the morning after radar-estimated hail touches it.' };
      if ((kind.futures || kind.report) && had.indexOf('price') < 0) O.price = { field: 1, label: 'Email me when</label> <select class="sa-mc" data-f="sym" aria-label="Futures contract">'
          + ['corn', 'beans', 'wheat', 'cattle'].map(function (k) { return '<option value="' + k + '"' + (k === kind.sym ? ' selected' : '') + '>' + { corn: 'corn', beans: 'soybean', wheat: 'wheat', cattle: 'live cattle' }[k] + '</option>'; }).join('')
          + '</select> futures go <select class="sa-mc" data-f="dir" aria-label="Direction"><option value="above">above</option><option value="below">below</option></select>'
          + ' $<input class="sa-mp" data-f="usd" type="number" inputmode="decimal" step="0.01" min="0.01" max="1000" aria-label="Futures price you want, dollars">',
        send: function (f) { return post(WORKER + '/price-watch-subscribe', priceBody(email, f.sym, f.dir, f.usd)); },
        ok: 'Check your email to confirm the futures alert. Nothing about it is sent until you press that link.' };
      if (gave === 'daily' && ctx.reports === false && (kind.report || kind.futures) && had.indexOf('reports') < 0) O.reports = {
        label: esc('USDA report days: a short email the afternoon a big report lands, what USDA printed against the trade'),
        /* the same list: no source, so the worker keeps where they signed up */
        send: function () { return post(EP, { email: email, reports: true }); },
        ok: 'Report-day emails are on.' };
      if (kind.cot && topic !== 'cot' && had.indexOf('cot') < 0 && !noticeDone('cot')) O.cot = {
        label: esc('Funds this week: where the big funds sit in corn, soybeans, wheat and cattle, one short email after each COT report'),
        send: function () { return notice({ email: email, source: source, topic: 'cot', daily: false, askId: 'onemore' }); },
        ok: 'Funds this week comes after each COT report.' };
      if ((kind.report || kind.futures) && gave !== 'daily' && topic !== 'reports' && had.indexOf('wasde') < 0 && !isSignedUp() && !noticeDone('reports')) O.wasde = {
        label: esc('The WASDE summary: what USDA printed against the trade, the afternoon of each big report'),
        send: function () { return notice({ email: email, source: source, topic: 'reports', daily: false, askId: 'onemore' }); },
        ok: 'The WASDE summary comes the afternoon of each big USDA report.' };
      var base = gave === 'daily' ? ['zip', 'rainyear', 'rent', 'daily'] : ['daily', 'rainyear', 'rent', 'zip'];
      var lead = kind.hail ? ['hail'] : kind.futures ? ['price', 'cot', 'reports', 'wasde'] : kind.report ? ['reports', 'wasde', 'cot', 'price'] : [];
      var order = gave === 'daily' ? lead.concat(base) : ['daily'].concat(lead, base.slice(1));
      var ids = order.filter(function (k) { return O[k]; }).slice(0, 3);
      if (!ids.length) { box.parentNode.removeChild(box); return; }
      var n = ++mseq;
      box.setAttribute('role', 'group'); box.setAttribute('aria-labelledby', 'sa-mh-' + n);
      box.innerHTML = '<p class="sa-mh" id="sa-mh-' + n + '">One more?</p><form class="sa-mf" novalidate>'
        + ids.map(function (k, i) {
          var id = 'sa-mo-' + n + '-' + i;
          /* a row with its own fields: the label is only the words before them */
          return O[k].field
            ? '<div class="sa-optin sa-mo" data-k="' + k + '"><input type="checkbox" id="' + id + '" value="' + k + '"><span><label for="' + id + '">' + O[k].label + '</span></div>'
            : '<label class="sa-optin sa-mo" data-k="' + k + '" for="' + id + '"><input type="checkbox" id="' + id + '" value="' + k + '"> <span>' + O[k].label + '</span></label>';
        }).join('')
        + '<button type="submit" class="sa-b">Add these</button><p class="sa-m" role="status" aria-live="polite"></p></form>';
      box.hidden = false;
      seen(box, 'onemore');
      track('onemore_shown', { from: gave, topics: ids.join(',') });
      if (barEl && barEl.contains(box)) placeBar();
      var form = box.querySelector('form'), msg = box.querySelector('.sa-m'), btn = box.querySelector('.sa-b');
      /* typing in a row's field or picking from its list is the reader ticking that row */
      Array.prototype.forEach.call(form.querySelectorAll('[data-k] input:not([type=checkbox]), [data-k] select'), function (el) {
        var c = el.closest('[data-k]').querySelector('input[type=checkbox]');
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
          if (el.classList.contains('sa-mz')) el.value = el.value.replace(/\D/g, '').slice(0, 5);
          if ((el.tagName === 'SELECT' || el.value) && !c.checked) c.checked = true;
          el.removeAttribute('aria-invalid');
        });
      });
      function row(k) { return form.querySelector('[data-k="' + k + '"]'); }
      function bad(el, t) { msg.textContent = t; el.setAttribute('aria-invalid', 'true'); el.focus(); }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var pick = Array.prototype.filter.call(form.querySelectorAll('input[type=checkbox]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
        if (!pick.length) { msg.textContent = 'Tick what you want, or leave it.'; return; }
        var f = {};
        if (pick.indexOf('zip') >= 0) {
          var zp = row('zip').querySelector('.sa-mp'), v = parseFloat(zp.value);
          if (!(v >= 1 && v <= 32)) return bad(zp, 'Enter the price you want, between $1.00 and $32.00 a bushel.');
          f.crop = row('zip').querySelector('.sa-mc').value; f.cents = Math.round(v * 100);
        }
        if (pick.indexOf('price') >= 0) {
          var pp = row('price').querySelector('[data-f="usd"]'), u = parseFloat(pp.value);
          if (!(u > 0 && u <= 1000 && isFinite(u))) return bad(pp, 'Enter the futures price you want, between $0.01 and $1000.');
          f.sym = row('price').querySelector('[data-f="sym"]').value; f.dir = row('price').querySelector('[data-f="dir"]').value; f.usd = u;
        }
        if (pick.indexOf('daily') >= 0 && O.daily.field) {
          var mz = row('daily').querySelector('.sa-mz'), zv = String(mz.value || '').trim();
          if (zv && !/^\d{5}$/.test(zv)) return bad(mz, 'A ZIP is 5 digits. Fix it, or leave it blank.');
          f.zip = zv;
        }
        msg.textContent = ''; btn.disabled = true; btn.textContent = 'Sending…';
        box.setAttribute('data-sa-busy', '1');
        Promise.all(pick.map(function (k) { return O[k].send(f); })).then(function (rs) {
          box.removeAttribute('data-sa-busy');
          var okIds = [], okTxt = [], err = '';
          rs.forEach(function (r, i) {
            var k = pick[i];
            if (r && r.ok) { okIds.push(k); okTxt.push(queued(r) ? '' : O[k].ok); var rw = row(k); if (rw) rw.parentNode.removeChild(rw); }
            else if (!err) err = errText(r);
          });
          if (okIds.length) track('onemore_added', { from: gave, topics: okIds.join(',') });
          if (!err) {
            box.innerHTML = '<p class="sa-ok" tabindex="-1">' + esc(rs.some(queued) ? queued(rs.filter(queued)[0]) : 'Added. ' + okTxt.join(' ')) + '</p>';
            if (barEl && barEl.contains(box)) { placeBar(); setTimeout(function () { closeBar(false); }, 6000); }
            return;
          }
          btn.disabled = false; btn.textContent = 'Add these';
          msg.textContent = (okTxt.length ? 'Added: ' + okTxt.join(' ') + ' ' : '') + err;
          if (barEl && barEl.contains(box)) placeBar();
        });
      });
    }
  }

  /* Signups drawn by other scripts. The cash bid box (components/cb-signup.js)
     is done when it draws .cbs-done; the Farmland Atlas county watch
     (farmland-atlas/watch.js) when its line says to check the inbox. The
     address is read from the form as it is sent and kept only for the panel. */
  function watchFor(el, done, fire) {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function () { if (done()) { mo.disconnect(); fire(); } });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    setTimeout(function () { mo.disconnect(); }, 60000);
  }
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.matches) return;
    if (f.matches('.cbs-f')) {
      var host = f.closest('[data-bid-alerts]'), d = f.querySelector('.cbs-d'), p = f.querySelector('.cbs-p'), z = f.querySelector('.cbs-zip');
      if (!host) return;
      var had = [];
      if (d && d.checked && !d.closest('[hidden]')) had.push('daily');
      if (p && p.checked) had.push('zip');
      var c1 = { gave: had[0] || 'daily', had: had, email: (f.querySelector('.cbs-em') || {}).value, zip: host.getAttribute('data-zip') || (z && z.value) || '' };
      watchFor(host, function () { return !!host.querySelector('.cbs-done'); }, function () { oneMore(host, c1); });
    } else if (f.matches('form.watch[data-fips]')) {
      var c2 = { gave: 'county', email: f.elements.email && f.elements.email.value, fips: f.getAttribute('data-fips'), after: f };
      var wm = f.querySelector('.wm');
      if (wm) watchFor(wm, function () { return /^Check your inbox/.test(wm.textContent || ''); }, function () { oneMore(f.parentNode, c2); });
    }
  }, true);

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
      if (show) { try { sessionStorage.setItem(BAR_SEEN, '1'); } catch (e) {} }
      barEl.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (!show) barEl.setAttribute('inert', ''); else barEl.removeAttribute('inert');
      document.body.style.paddingBottom = show ? h + 'px' : '';
    });
  }
  /* 2026-10-20 (Sig):
     - the bar shows at most once a browser session (agsist_bar_seen, set
       the first time it is on screen); before this it came back on every
       page of a visit until it was closed;
     - a first visit gets it too, but only after the reader has used the
       page: on a phone past half the page or 40 seconds on it, on a wider
       screen 40 seconds (time the tab is hidden does not count). A second
       visit or later gets it as before;
     - one Daily ask a page: where the page shows its own ask (a page ask,
       the homepage hero line, the cash bid box, a rent, rain year or ARC/PLC
       notice ask) the bar stays away. The footer band and the menu box do
       not count. The PRF grid notice does not count either: PRF pages keep
       the bar (Sig, Oct 20). */
  var BAR_SEEN = 'agsist_bar_seen', ENGAGE_S = 40;
  function ownAsk() {
    var a = document.querySelectorAll('[data-signup-ask],[data-bid-alerts]');
    for (var i = 0; i < a.length; i++) {
      var el = a[i];
      if (el.closest('#sa-bar,footer,#topnav,#drawer,[data-signup-hide],[data-prf-notice]')) continue;
      if (/^(footer|menu-desk|menu-phone|bar)$/.test(el.getAttribute('data-source') || '')) continue;
      if (/^prf:/.test(el.getAttribute('data-topic') || '')) continue;
      if (el.hidden || el.closest('[hidden]')) continue;
      return true;
    }
    return false;
  }
  function barOk() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    /* No sticky bar where it covers the work or is the wrong ask: the briefing
       and its archive (/daily/2026-10-11), the field tools and print sheets,
       the sponsor pages, the store-or-sell worksheet (2026-10-11), and /prf
       itself (2026-10-12; its county pages keep it, Sig Oct 20). */
    if (/^\/(daily|field-scout|rain-print|sponsor|sponsor-kit|sponsor-apply|sponsor-report|store-or-sell|prf)(\.html)?$/.test(p)
        || /^\/daily\/[^/]+$/.test(p)) return false;
    if (isSignedUp() || isDismissed(BAR_KEY)) return false;
    try { if (Date.now() < +(localStorage.getItem('agsist_bar_snooze') || 0)) return false; } catch (e) {}
    try { if (sessionStorage.getItem(BAR_SEEN) === '1') return false; } catch (e) {}
    if (document.getElementById('sa-bar')) return false;
    return !ownAsk();
  }
  function engaged(fn) {
    var t = 0, fired = false, iv = 0, phone = window.innerWidth < 640;
    function go() { if (fired) return; fired = true; clearInterval(iv); window.removeEventListener('scroll', sc); fn(); }
    function sc() {
      var d = document.documentElement, max = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight;
      if (max > 0 && (window.scrollY || d.scrollTop || 0) / max >= 0.5) go();
    }
    iv = setInterval(function () { if (document.visibilityState !== 'hidden' && ++t >= ENGAGE_S) go(); }, 1000);
    if (phone) window.addEventListener('scroll', sc, { passive: true });
  }
  function bar() {
    if (!barOk()) return;
    if (visits() >= 2) openBar();
    else engaged(function () { if (barOk()) openBar(); });
  }
  function openBar() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
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
    b.querySelector('.sa-x').addEventListener('click', function () { dismissed('bar', 'close'); closeBar(true); });
    b.addEventListener('keydown', function (e) { if (e.key === 'Escape') { dismissed('bar', 'escape'); closeBar(false); } });
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
    source: sourceFor, mount: mount, scan: scan, css: css,
    oneMore: oneMore, seen: seen, dismissed: dismissed
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
