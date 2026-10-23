/* The monthly land sale email ask (Sig, Oct 23, 2026: new list, sender and schedule approved).

   "Email me new farm sales near me, once a month": an email, a ZIP and a radius (10, 25 or 50
   miles, 25 picked). It posts the worker's /notice with topic landsales:<ZIP>:<miles>
   (subs worker v5.55); scripts/send_land_alert.py mails it on the 3rd of each month with the
   farm sales recorded the month before within that radius, Illinois and Wisconsin. A month with
   no sales sends nothing. After it goes through, the site's "One more?" panel
   (AgsistSignup.oneMore) offers the Daily, never ticked.

   Where it shows (components/loader.js loads this file on any page that has a host):
     <div data-land-alert></div>                       a hand-placed host (the comp report)
     <div data-land-alert data-follow="#fl-comps"></div>  waits for that element and sits after it,
                                                        again after each redraw (Field Scout's
                                                        Sold land nearby)
     <div data-land-alert data-near-only="1"></div>     shows only for a ZIP in or beside Illinois
                                                        or Wisconsin (Fast Facts' Land card)
     section[data-atlas-sales="county"][data-st=IL|WI]  the Atlas county pages' recorded sales: a
                                                        host is added after it (no page rebuild)
   Optional: data-source (default page:<path>), data-zip.
   The ZIP box starts with data-zip, the page's ?zip=, or the saved ZIP; never geolocation.
   Names never appear here: the ask says so, and the email never shows them.
   No em dashes, no ticked boxes, no counts. */
(function () {
  'use strict';
  if (window.AgLandAlert) { window.AgLandAlert.scan(); return; }
  var EP = 'https://agsist-api.dnilgis.workers.dev/notice';
  var MILES = [10, 25, 50], DEF = 25;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  /* ZIP3 in or beside Illinois and Wisconsin: IL 600-629, WI 530-549, IA 500-528, MN 550-567,
     IN 460-479, MO 630-658, KY 400-427, MI 480-499 */
  var NEAR = /^(6[0-2]\d|5[34]\d|50\d|51\d|52[0-8]|55\d|56[0-7]|4[67]\d|6[34]\d|65[0-8]|4[01]\d|42[0-7]|4[89]\d)/;
  var HEAD = 'Email me new farm sales near me, once a month';
  var SUB = 'The farm sales recorded each month within the miles you pick of your ZIP: the date, acres, price per acre and township. '
    + 'Illinois and Wisconsin for now. Never who bought or sold. A month with no sales sends nothing.';
  var seq = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function S() { return window.AgsistSignup || null; }
  function topicOf(zip, mi) { return 'landsales:' + zip + ':' + mi; }
  function okZip(z) { return /^\d{5}$/.test(z) && z !== '00000'; }
  function startZip(el) {
    var z = el.getAttribute('data-zip') || '';
    if (!okZip(z)) { var m = /[?&]zip=(\d{5})\b/.exec(location.search || ''); z = m ? m[1] : ''; }
    if (!okZip(z) && S() && S().zip) { try { z = String(S().zip() || ''); } catch (e) { z = ''; } }
    return okZip(z) ? z : '';
  }
  function sourceOf(el) {
    var s = el.getAttribute('data-source');
    if (s) return s.slice(0, 60);
    return ('page:' + (location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'home')).slice(0, 60);
  }

  var CSS = [
    '.la-ask{font-family:var(--font-body,Inter,system-ui,sans-serif);color:var(--text);margin:16px 0;padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface,transparent)}',
    '.la-ask[hidden]{display:none!important}',
    '.la-h{margin:0 0 4px;font-size:.9375rem;font-weight:700;line-height:1.35}',
    '.la-s{margin:0 0 10px;font-size:.8125rem;line-height:1.45;color:var(--text-muted)}',
    '.la-f{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 10px;margin:0}',
    '.la-fl{display:flex;flex-direction:column;gap:2px;font-size:.8125rem;color:var(--text-muted);min-width:0}',
    '.la-fe{flex:1 1 14rem}.la-fz{flex:0 0 6.5rem}.la-fm{flex:0 0 auto}',
    '.la-in,.la-sel{box-sizing:border-box;width:100%;min-height:44px;padding:.5rem .7rem;font:inherit;font-size:1rem;color:var(--text);background:var(--surface,#fff);border:1px solid var(--border-2,var(--border));border-radius:6px}',
    '.la-sel{padding-right:1.6rem}',
    '.la-in:focus,.la-sel:focus{outline:2px solid var(--gold);outline-offset:1px;border-color:var(--gold)}',
    '.la-in[aria-invalid="true"]{border-color:var(--red)}',
    '.la-b{min-height:44px;padding:.5rem .9rem;font:inherit;font-size:.9375rem;font-weight:700;color:#0a0c0d;background:#d4a23f;border:0;border-radius:6px;cursor:pointer;white-space:nowrap}',
    '.la-b:hover{filter:brightness(.94)}.la-b:focus-visible{outline:2px solid var(--text);outline-offset:2px}.la-b[disabled]{opacity:.75;cursor:default}',
    '.la-m{flex:1 1 100%;margin:0;font-size:.875rem;line-height:1.4;color:var(--red)}.la-m:empty{display:none}',
    '.la-ok{margin:0;font-size:.9375rem;font-weight:700;line-height:1.4;color:var(--green)}.la-ok:focus{outline:none}',
    '@media print{.la-ask{display:none!important}}'
  ].join('');
  function css() {
    if (document.getElementById('la-css')) return;
    var st = document.createElement('style'); st.id = 'la-css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function post(body) {
    if (S() && S().notice) return S().notice(body);
    return fetch(EP, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email: body.email, source: body.source, topic: body.topic, daily: false }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: !!(r.ok && d && d.ok === true), status: r.status, data: d }; }); },
        function () { return { ok: false, status: 0, data: null }; });
  }
  function errText(res) {
    if (S() && S().errText) return S().errText(res);
    return 'That did not go through. Nothing was saved. Try again, or email sig@agsist.com and I will add you by hand.';
  }

  function draw(el) {
    if (el.getAttribute('data-la-ready')) return;
    el.setAttribute('data-la-ready', '1');
    css();
    var n = ++seq, eid = 'la-e-' + n, zid = 'la-z-' + n, mid = 'la-mi-' + n, msgid = 'la-msg-' + n, hid = 'la-h-' + n;
    el.classList.add('la-ask', 'no-print');
    el.setAttribute('role', 'group'); el.setAttribute('aria-labelledby', hid);
    el.innerHTML = '<p class="la-h" id="' + hid + '">' + esc(HEAD) + '</p><p class="la-s">' + esc(SUB) + '</p>'
      + '<form class="la-f" novalidate>'
      + '<label class="la-fl la-fe" for="' + eid + '">Email<input class="la-in" id="' + eid + '" type="email" name="email" autocomplete="email" inputmode="email" placeholder="your@email.com" required aria-describedby="' + msgid + '"></label>'
      + '<label class="la-fl la-fz" for="' + zid + '">Your ZIP<input class="la-in" id="' + zid + '" type="text" name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="5" placeholder="5 digits"></label>'
      + '<label class="la-fl la-fm" for="' + mid + '">Within<select class="la-sel" id="' + mid + '" name="miles">'
      + MILES.map(function (m) { return '<option value="' + m + '"' + (m === DEF ? ' selected' : '') + '>' + m + ' miles</option>'; }).join('')
      + '</select></label>'
      + '<button class="la-b" type="submit">Email me</button>'
      + '<p class="la-m" id="' + msgid + '" role="status" aria-live="polite"></p></form>';
    var form = el.querySelector('form'), em = el.querySelector('#' + eid), zp = el.querySelector('#' + zid), mi = el.querySelector('#' + mid);
    var btn = el.querySelector('.la-b'), msg = el.querySelector('.la-m');
    zp.value = startZip(el);
    zp.addEventListener('input', function () { zp.value = zp.value.replace(/\D/g, '').slice(0, 5); zp.removeAttribute('aria-invalid'); });
    em.addEventListener('input', function () { em.removeAttribute('aria-invalid'); });
    function bad(f, t) { msg.textContent = t; f.setAttribute('aria-invalid', 'true'); f.focus(); }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = String(em.value || '').trim(), zip = String(zp.value || '').trim(), miles = +mi.value;
      if (!EMAIL_RE.test(email)) return bad(em, 'Check the email address.');
      if (!okZip(zip)) return bad(zp, 'A ZIP is 5 digits.');
      if (MILES.indexOf(miles) < 0) miles = DEF;
      msg.textContent = ''; btn.disabled = true; btn.textContent = 'Sending…';
      var topic = topicOf(zip, miles), source = sourceOf(el);
      post({ email: email, source: source, topic: topic, daily: false, askId: 'landsales' }).then(function (res) {
        if (!res || !res.ok) { btn.disabled = false; btn.textContent = 'Email me'; msg.textContent = errText(res); return; }
        var q = res.data && res.data.queued === true ? String(res.data.message || "Got it. You'll be added within a day.") : '';
        el.innerHTML = '<p class="la-ok" tabindex="-1">' + esc(q || ('Done. On the 3rd of each month you get the farm sales recorded within '
          + miles + ' miles of ' + zip + ' the month before. A month with none sends nothing.')) + '</p>';
        var ok = el.querySelector('.la-ok'); if (ok && ok.focus) ok.focus();
        if (S() && S().oneMore) S().oneMore(el, { gave: 'notice', topic: topic, email: email, zip: zip });
      });
    });
    el.hidden = false;
    if (S() && S().seen) { try { S().seen(el, 'landsales'); } catch (x) {} }
  }

  function placeFollow(el) {
    var sel = el.getAttribute('data-follow');
    var t = sel ? document.querySelector(sel) : null;
    if (!t) { el.hidden = true; return; }
    if (t.nextSibling !== el) t.parentNode.insertBefore(el, t.nextSibling);
    draw(el);
  }

  function scan() {
    /* the Atlas county pages' recorded sales block: a host after it (IL and WI) */
    Array.prototype.forEach.call(document.querySelectorAll('section[data-atlas-sales="county"]'), function (s) {
      if (!/^(IL|WI)$/.test(s.getAttribute('data-st') || '') || s.getAttribute('data-la-host')) return;
      s.setAttribute('data-la-host', '1');
      var h = document.createElement('div'); h.setAttribute('data-land-alert', '');
      h.setAttribute('data-source', ('page:' + location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '')).slice(0, 60));
      s.parentNode.insertBefore(h, s.nextSibling);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-land-alert]'), function (el) {
      if (el.getAttribute('data-follow')) { placeFollow(el); return; }
      if (el.getAttribute('data-near-only') === '1') {
        var z = startZip(el);
        if (!z || !NEAR.test(z)) { el.hidden = true; return; }
      }
      draw(el);
    });
  }

  /* hosts that wait: a followed element drawn later (Field Scout) or a ZIP that arrives with the
     place (Fast Facts' ?zip= on a later pushState). Watch for an hour at most. */
  function watch() {
    if (!window.MutationObserver) return;
    var waiting = document.querySelector('[data-land-alert][data-follow],[data-land-alert][data-near-only="1"]');
    if (!waiting) return;
    var busy = false;
    var mo = new MutationObserver(function () {
      if (busy) return; busy = true;
      setTimeout(function () { busy = false; scan(); }, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, 3600e3);
  }

  window.AgLandAlert = { scan: scan, topicOf: topicOf, okZip: okZip, NEAR: NEAR, MILES: MILES, DEF: DEF };
  function ready() { scan(); watch(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
