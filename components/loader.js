// AGSIST Component Loader — injects header (+ drawer), footer, analytics; initialises nav after inject
(function () {
  'use strict';

  // Apply the saved theme; with no saved choice, follow the device
  // (prefers-color-scheme). Dark stays the fallback when the device says nothing.
  // wave1-E 2026-10-03: a first visit used to be forced dark, and the toggle
  // init below then saved that, so the device setting was never heard.
  function deviceTheme() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
    catch (e) { return 'dark'; }
  }
  function savedTheme() {
    try { var s = localStorage.getItem('agsist-theme'); return s === 'light' || s === 'dark' ? s : null; }
    catch (e) { return null; }
  }
  try { document.documentElement.setAttribute('data-theme', savedTheme() || deviceTheme()); } catch (e) {}

  // NO SIGNUP IS LOST WHEN THE SUBS WORKER IS BLOCKED (2026-10-22). Oct 21,
  // Cloudflare answered the worker with its phishing page and no CORS, so every
  // email signup box failed. Every signup on the site posts to one of the
  // routes below with fetch; when that post cannot reach the worker (the
  // browser refuses the answer, no answer, or a 403/404/405/5xx that is not
  // the worker's own JSON) the same signup goes to the Formspree form the site
  // forms already fall back to (components/form-post.js), tagged with its list,
  // and the page gets {ok:true, queued:true}. The reader is told plainly:
  // "Got it. You'll be added within a day." Nothing is mailed to them until
  // Sig adds them to the list (and, for alerts, they confirm), so a signup
  // that was never confirmed is kept, never mailed. A refusal the worker
  // means (its JSON answer: a bad address, too many tries) reaches the page as
  // before. Never the address in a URL; it travels in the post body only.
  (function signupFallback() {
    if (typeof window.fetch !== 'function' || window.agsistSignupFallback) return;
    // Both worker hosts during the move to agsist-api (Oct 22): a page cached
    // before the move still posts to the old one.
    var HOSTS = { 'agsist-api.dnilgis.workers.dev': 1, 'agsist-subs.dnilgis.workers.dev': 1 };
    var LISTS = { '/subscribe': 'AGSIST Daily', '/notice': 'notice', '/alert-subscribe': 'hail alert',
      '/watch-subscribe': 'farmland watch', '/elevator-watch-subscribe': 'elevator alert', '/price-watch-subscribe': 'price alert' };
    var FORMSPREE = 'https://formspree.io/f/xnjbwepn';
    var QUEUED = "Got it. You'll be added within a day.";
    var real = window.fetch;
    function routeOf(u) {
      try { var x = new URL(String(u), location.href); return HOSTS[x.host] === 1 && LISTS[x.pathname] ? x.pathname : ''; }
      catch (e) { return ''; }
    }
    function fields(body) {
      var o = {};
      try {
        if (typeof body === 'string') {
          try { o = JSON.parse(body) || {}; } catch (e) { new URLSearchParams(body).forEach(function (v, k) { o[k] = v; }); }
        } else if (body && typeof body.forEach === 'function') {
          body.forEach(function (v, k) { o[k] = typeof v === 'string' ? v : ''; });
        }
      } catch (e) {}
      return o && typeof o === 'object' ? o : {};
    }
    function say() {
      try {
        var old = document.getElementById('signup-queued'); if (old) old.remove();
        var bar = document.createElement('div');
        bar.id = 'signup-queued'; bar.setAttribute('role', 'status');
        bar.style.cssText = 'background:#1f5130;color:#fff;font-size:1rem;line-height:1.4;padding:10px 44px 10px 16px;position:fixed;left:0;right:0;bottom:0;z-index:9990;text-align:center;box-shadow:0 -2px 8px rgba(0,0,0,.25)';
        bar.textContent = QUEUED + ' No need to look for a confirmation email for now.';
        var x = document.createElement('button');
        x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
        x.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;color:#fff;font-size:1.3rem;cursor:pointer;padding:4px 8px';
        x.addEventListener('click', function () { bar.remove(); });
        bar.appendChild(x);
        document.body.appendChild(bar);
        setTimeout(function () { if (bar.parentNode) bar.remove(); }, 15000);
      } catch (e) {}
    }
    function queue(route, init, orig, err) {
      var f = fields(init && init.body), fd = new FormData(), extra = {};
      var list = LISTS[route] + (f.topic ? ' (' + String(f.topic).slice(0, 60) + ')' : '');
      Object.keys(f).forEach(function (k) {
        if (['email', 'zip', 'source', 'topic', 'src'].indexOf(k) < 0 && f[k] !== undefined && f[k] !== null) extra[k] = f[k];
      });
      fd.append('_subject', 'AGSIST signup (worker down): ' + list);
      fd.append('form', 'signup-fallback');
      fd.append('list', list);
      fd.append('email', String(f.email || ''));
      if (/^\d{5}$/.test(String(f.zip || ''))) fd.append('zip', String(f.zip));
      fd.append('source', String(f.source || f.src || '').slice(0, 60));
      fd.append('page', location.pathname);
      if (Object.keys(extra).length) fd.append('details', JSON.stringify(extra).slice(0, 1500));
      fd.append('note', 'Not on the list yet and not confirmed: add by hand when the worker is back; mail nothing before that.');
      return real.call(window, FORMSPREE, { method: 'POST', body: fd, headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
        .then(function (j) {
          if (!j || j.ok === false || j.errors) throw new Error('not sent');
          window.dispatchEvent(new CustomEvent('agsist:signup-queued', { detail: { list: LISTS[route] } }));
          say();
          return new Response(JSON.stringify({ ok: true, queued: true, message: QUEUED }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
        })
        .catch(function () { if (orig) return orig; throw err || new Error('not sent'); });
    }
    window.agsistSignupFallback = { QUEUED: QUEUED, lists: LISTS };
    // WHAT THIS BROWSER STILL OWES THE WORKER (2026-10-22): a gift card order,
    // a business quote, a hay post, an elevator's bids or a confirm kept while
    // the worker was blocked. components/outbox.js sends it once the worker
    // answers; it is loaded here, on any page, only while something is kept.
    try {
      if (!window.AgOutbox && localStorage.getItem('agsist-outbox') && !document.querySelector('script[src^="/components/outbox.js"]')) {
        var ob = document.createElement('script'); ob.src = '/components/outbox.js?v=3'; ob.defer = true;
        (document.head || document.documentElement).appendChild(ob);
      }
    } catch (e) { /* storage blocked: nothing can be kept either */ }
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var route = method === 'POST' ? routeOf(url) : '';
      if (!route) return real.apply(this, arguments);
      return real.apply(this, arguments).then(function (r) {
        if (r.status === 403 || r.status === 404 || r.status === 405 || r.status >= 500) {
          // the worker's own JSON is a real answer; anything else is the block page or an outage
          return r.clone().json().then(function () { return r; }, function () { return queue(route, init, r); });
        }
        return r;
      }, function (err) { return queue(route, init, null, err); });
    };
  })();

  var BASE = (function () {
    var m = document.querySelector('meta[name="agsist-base"]');
    return m ? m.getAttribute('content').replace(/\/$/, '') : '';
  })();

  // Component cache version. Bump on every chrome deploy so browsers fetch the
  // new header/footer; between deploys the files cache normally (no refetch /
  // no nav-flash on each page navigation).
  var CV = '83'; // v83 2026-10-22: fx/fastfacts. /here moved into Fast Facts: the header My place link, the ZIP box and the My place tile open /fast-facts; footer drops Status (/status retired, Sig Oct 21); footer Field link reads Fast Facts (was Fast Facts reference tables, Sig Oct 22); v82 2026-10-22: outbox.js?v=3 and signup-ask.js?v=15 (the contact line names sig@agsist.com); v81 2026-10-22: the subs worker moves to agsist-api.dnilgis.workers.dev (signup backup takes either host; outbox.js?v=2, signup-ask.js?v=14); v79 2026-10-22: components/outbox.js is loaded on any page while this browser keeps something the blocked worker could not take (it sends it once the worker answers); v78 2026-10-22: signup-ask.js?v=13 (a signup the blocked worker could not take is kept on the backup form: "Got it. You'll be added within a day."); v77 2026-10-21: footer drops the data sources links (Sig); v76 2026-10-21: signup-ask.js?v=13 (One more? offers the WASDE summary and Funds this week, the two standing lists of subs worker v5.44); v75 2026-10-21: site notice bar from data/site-notice.json (outage line, Sig); v74 2026-10-21: Grain on the move (/grain-transport) under Prices, Near you, after Basis vs normal (Sig approved Oct 21); v73 2026-10-20: signup-ask.js?v=11 (One more? after the hail alert and elevator alerts); v72 2026-10-20: footer adds List your elevator, free under Work with us; v71 2026-10-20: menu: "Everything near me" (/here) first in the phone panel's My place row and the ZIP box's link once a ZIP is saved; Yield by state (/usda-quick-stats) under Prices, Reports; Farmland sale index (/farmland-index) under Money & Land, Land, after Farmland Atlas (Sig approved Oct 20); v70 2026-10-20: signup-ask.js?v=10 (One more? after any signup, first-visit bar after engagement, one Daily ask per page); v69 2026-10-19: the menu and footer Daily asks say "every morning", not "every weekday morning" (Sig); v68 2026-10-19: header menu folds at 60em, not 960px, so a reader with a larger default font gets the menu button instead of an overrun menu (a11y); v67 2026-10-18: The Haymow (hay for sale and wanted) in the menu, the phone panel and the footer under Livestock, after Hay; v66 2026-10-18: search.js offers "Everything about <place>" (/here) under a ZIP, town or county; v65 2026-10-18: footer line reads "Updated as each source posts." (Sig); v64 2026-10-18: sponsor-metrics.js loads first on DOMContentLoaded; v63 2026-10-18: footer on one grid (logo + tagline left, daily email box or the daily links and Rain Print line right, six columns on the same grid, one small line with the legal links), Next block as aligned cards (next-links.js?v=3); v62 2026-10-18: the full new menu (Prices | Livestock | Field | Money & Land | Daily, short noun subheads, ZIP chip "Bids near <town>", Free daily email button, phone panel with search, My place row, every group open, Rain Print card; footer band with the daily email and Rain Print line, columns Prices | Livestock | Field | Money & Land | Work with us | About; "Harvest tools moved to Field" note until Nov 1); v61 2026-10-18: menu fixes round 1 (search.js takes a ZIP, drops near me/price words, finds towns with no page; drawer focus trap, aria-modal, focus back to the menu button; aria-controls on dropdowns; footer column names are spans, not <h2> in <summary>; Pod counts, Drought monitor, Planting date, Field Scout and Urea loss risk in the menu; Rain Print for business in the footer; phone header theme switch moved into the menu); v60 2026-10-17: signup-ask.js?v=8 (passes data-after for PRF grid notices); v59 2026-10-17: signup-ask.js?v=7 (briefing box ticked on alert asks); v58 2026-10-17: Custom rates in the menu and footer under Money & Land; v57 2026-10-17: Rain on your field (radar) in the menu and footer under Crop & Field; v56 2026-10-17: high-contrast menu button (forced-colors styles in header.html); v55 2026-10-17: Cash Bid Index in the menu and footer; v54 2026-10-16: Editorial standards in the footer; v53 2026-10-16: Fall anhydrous soil temp and Harvest now or wait in the menu and footer; v52 2026-10-16: Combine loss check and CCC loan calculator in the menu and footer; v51 2026-10-16: Sale barn prices in the menu and footer under Markets; v50 2026-10-16: Hay prices in the menu and footer under Markets; v49 2026-10-16: Nutrient removal value in the menu and footer, grain shrink separator in the no-script menu; v48 2026-10-16: Grain shrink in the menu and footer; v47 2026-10-15: Harvest price tracker named in full and moved to Markets, after Milk (Sig could not find it); v46 2026-10-15: LRP livestock price insurance in the menu and footer; v45 2026-10-15: Grain EMC in the menu and footer; v44 2026-10-14: Manure value and Fast Facts reference tables in the menu and footer; v43 2026-10-13: Rain by county in the menu and footer; v42 2026-10-13: Rain Print and the rain gauge page in the menu and footer; v41 2026-10-12: craft pass, service worker registers from loader.js; v40 2026-10-12: icons on Corn, Soybeans, Wheat, Cattle, Milk and the footer's last four links; v39 2026-10-11: signup-ask.js?v=6 (optional ZIP on Daily asks, one-time notice asks); v38 2026-10-11: menu label Harvest price; v37 2026-10-11: footer supporter strip hidden until a supporter is active, bottom-row Advertise link; v36 2026-10-10: the menu grouped by question, phone drawer folds each question; v35 2026-10-09: ARC or PLC short-answer pages; v34 2026-10-09: ARC or PLC link in the menu and footer; v33 2026-10-09: ARC/PLC calculator; v32 2026-10-09: plainer copy in shared components; v31 2026-10-09: signup wording, card tokens; v30 2026-10-09: one look, variable fonts; v29 2026-10-09: no-jump layout and loading states kit; v28 2026-10-09: menu shows Farmland Atlas once, footer keeps Cash Rent by State; v27 2026-10-09: instant pages, prerender-safe analytics, Updated stamps; v26 2026-10-09: header search button; v25 2026-10-09: em-dash cleanup and link fixes; v24 2026-10-08: footer sponsor pill no longer overlaps on phones; v23 2026-10-08: footer link columns fold into <details> on phones (closed at 700px and under)
                 // v22 2026-09-19: the Farmland Atlas link restored to the Land group, drawer and footer (the 9/13 upload dropped it)
                 // v21 2026-09-13: Farmland Atlas link in the Land group of the header, the drawer and the footer
                 // v20 2026-09-05: sponsor-metrics.js loaded sitewide; footer sponsor card measured on the MRC rule
  function cv(path) { return path + (path.indexOf('?') < 0 ? '?v=' : '&v=') + CV; }

  function loadComponent(id, path, onDone) {
    var el = document.getElementById(id);
    if (!el) { if (onDone) onDone(); return; }
    fetch(BASE + cv(path))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        // Insert ALL child nodes — header.html has <nav> + <div.drawer> + <div.draw-ov> as siblings.
        // replaceWith(firstElementChild) only injected <nav>, dropping drawer + overlay.
        var frag = document.createDocumentFragment();
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        el.replaceWith(frag);
        if (onDone) onDone();
      })
      .catch(function () {
        // AUDIT 2026-08-11: a failed header fetch used to leave an empty div
        // — no nav at all. header-fallback.html exists for exactly this;
        // one retry with it before giving up. (Footer has a static fallback.)
        if (id === 'site-header' && path.indexOf('header-fallback') === -1) {
          loadComponent(id, '/components/header-fallback.html', onDone);
          return;
        }
        if (onDone) onDone();
      });
  }

  // Inject GA4 analytics unless the page already has gtag loaded inline
  function injectAnalytics() {
    if (typeof window.gtag === 'function') return;
    fetch(BASE + cv('/components/analytics.html'))
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        tmp.querySelectorAll('script').forEach(function (oldScript) {
          var s = document.createElement('script');
          if (oldScript.src) { s.src = oldScript.src; s.async = true; }
          else { s.textContent = oldScript.textContent; }
          document.head.appendChild(s);
        });
      })
      .catch(function () {});
  }

  function initNav() {

    // ── Skip-link target ─────────────────────────────────────────
    // Ensure the page's main content is focusable so the header skip-link
    // works site-wide without per-page edits.
    (function () {
      var main = document.querySelector('main, [role="main"], #main, #content, #main-content');
      if (main) {
        if (!main.id) main.id = 'main';
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      }
    })();

    // ── One skip link ────────────────────────────────────────────
    // header.html supplies a.skip-link; many pages also carry an inline
    // a.skip. Two tab stops for one action: drop the page copy once the
    // header copy exists. Pages on the header fallback keep their own.
    (function () {
      if (!document.querySelector('a.skip-link')) return;
      document.querySelectorAll('a.skip').forEach(function (a) { a.remove(); });
    })();

    // ── Theme toggle ─────────────────────────────────────────────
    function applyTheme(th, save) {
      document.documentElement.setAttribute('data-theme', th);
      // only a press of the toggle is a choice worth remembering
      if (save) { try { localStorage.setItem('agsist-theme', th); } catch (e) {} }
      // Icon (moon/sun) is now a CSS-toggled SVG pair keyed off [data-theme];
      // no textContent here so the inline <svg>s aren't clobbered on toggle.
      var lbl  = th === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
      ['theme-btn', 'theme-btn-d'].forEach(function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.setAttribute('aria-label', lbl);
      });
    }
    applyTheme(savedTheme() || deviceTheme(), false);
    // no saved choice: keep following the device if it switches (dusk, settings)
    try {
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
      var onDev = function () { if (!savedTheme()) applyTheme(deviceTheme(), false); };
      if (mq && mq.addEventListener) mq.addEventListener('change', onDev);
      else if (mq && mq.addListener) mq.addListener(onDev);
    } catch (e) {}

    ['theme-btn', 'theme-btn-d'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
      });
    });

    // ── Brand theme picker retired (committed single-gold identity) ──

    // ── Dropdowns — with aria-haspopup + aria-expanded ───────────
    // FIX P10: screen readers now know these buttons control popup menus
    document.querySelectorAll('.nav-dd').forEach(function (dd) {
      var trigger = dd.querySelector('.nav-btn');
      if (!trigger) return;

      // Set ARIA attributes on first load
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      var panel = dd.querySelector('.nav-panel');
      if (panel) {
        if (!panel.id) panel.id = (dd.id || 'dd') + '-panel';
        trigger.setAttribute('aria-controls', panel.id);
      }

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasOpen = dd.classList.contains('open');
        // Close all dropdowns and reset their aria-expanded
        document.querySelectorAll('.nav-dd').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('.nav-btn');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
        if (!wasOpen) {
          dd.classList.add('open');
          trigger.setAttribute('aria-expanded', 'true');
          fitPanel(panel);
        }
      });
      // A click inside an open panel (the signup box, the moved note) keeps it open.
      if (panel) panel.addEventListener('click', function (e) { e.stopPropagation(); });
    });

    // An open panel stays inside the window: wide three-column panels under
    // the right-hand buttons would run off the edge on a laptop screen.
    function fitPanel(panel) {
      if (!panel) return;
      panel.style.marginLeft = '';
      var r = panel.getBoundingClientRect(), vw = document.documentElement.clientWidth || window.innerWidth;
      var over = r.right - (vw - 16);
      if (over > 0) panel.style.marginLeft = (-Math.min(over, Math.max(0, r.left - 16))) + 'px';
    }

    document.addEventListener('click', function () {
      document.querySelectorAll('.nav-dd').forEach(function (d) {
        d.classList.remove('open');
        var t = d.querySelector('.nav-btn');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    });

    // ── Mobile drawer — with inert + aria-hidden focus trap fix ──
    // FIX P10: inert attribute prevents keyboard focus reaching hidden drawer elements
    // FIX P08: hamburger gets min-height:44px for touch target compliance
    var ham = document.getElementById('hamburger');
    var dr  = document.getElementById('drawer');
    var ov  = document.getElementById('draw-ov');
    var dc  = document.getElementById('draw-close');

    // Apply 44px min-height to hamburger after injection (P08 fix)
    if (ham) {
      ham.style.minHeight = '44px';
      ham.style.minWidth  = '44px';
      // Initial ARIA state
      ham.setAttribute('aria-expanded', 'false');
      ham.setAttribute('aria-controls', 'drawer');
      if (!ham.getAttribute('aria-label')) ham.setAttribute('aria-label', 'Open navigation menu');
    }

    // Set initial inert state on drawer (closed at load)
    if (dr) {
      dr.setAttribute('aria-hidden', 'true');
      dr.setAttribute('inert', '');
      dr.setAttribute('aria-modal', 'true');
    }

    // Focus stays inside the open drawer (2026-10-18): Tab from the last
    // control goes to the first, Shift+Tab from the first to the last. Links
    // inside a folded question are skipped, as the browser skips them.
    function drFocusables() {
      if (!dr) return [];
      return Array.prototype.filter.call(dr.querySelectorAll('a[href], button, summary, input, select, [tabindex]:not([tabindex="-1"])'), function (el) {
        if (el.disabled) return false;
        var d = el.closest('details');
        if (d && !d.open && el.tagName !== 'SUMMARY') return false;
        if (el.tagName === 'SUMMARY' && d && d.parentElement && d.parentElement.closest('details:not([open])')) return false;
        return el.offsetParent !== null || el.getClientRects().length > 0;
      });
    }
    if (dr) dr.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || !dr.classList.contains('open')) return;
      var f = drFocusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || !dr.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !dr.contains(at))) { e.preventDefault(); first.focus(); }
    });
    // A click or a focus that lands outside the open drawer comes back in.
    document.addEventListener('focusin', function (e) {
      if (!dr || !dr.classList.contains('open') || dr.contains(e.target)) return;
      var f = drFocusables();
      if (f.length) f[0].focus();
    });

    function openDr() {
      if (dr) {
        dr.classList.add('open');
        dr.setAttribute('aria-hidden', 'false');
        dr.removeAttribute('inert');
        // Move focus into drawer for keyboard users
        var firstLink = dr.querySelector('a, button, [tabindex="0"]');
        if (firstLink) { setTimeout(function(){ firstLink.focus(); }, 50); }
      }
      if (ov)  ov.classList.add('vis');
      if (ham) {
        ham.classList.add('open');
        ham.setAttribute('aria-expanded', 'true');
        ham.setAttribute('aria-label', 'Close navigation menu');
      }
      document.body.style.overflow = 'hidden';
      document.documentElement.classList.add('drawer-open');
    }

    function closeDr(leaveFocus) {
      var wasOpen = !!(dr && dr.classList.contains('open'));
      if (dr) {
        dr.classList.remove('open');
        dr.setAttribute('aria-hidden', 'true');
        dr.setAttribute('inert', '');
      }
      if (ov)  ov.classList.remove('vis');
      if (ham) {
        ham.classList.remove('open');
        ham.setAttribute('aria-expanded', 'false');
        ham.setAttribute('aria-label', 'Open navigation menu');
      }
      document.body.style.overflow = '';
      document.documentElement.classList.remove('drawer-open');
      // Hand focus back to the menu button, so a keyboard reader is where they were.
      if (wasOpen && leaveFocus !== true && ham && ham.offsetParent !== null) ham.focus();
    }

    window.closeDr = closeDr;

    var sb = document.getElementById('srch-btn');
    if (sb) sb.addEventListener('click', openSearch);
    // The phone panel's search box: close the panel first (its focus trap
    // would pull focus back from the search sheet), then open the sheet.
    var dsb = document.getElementById('draw-srch');
    if (dsb) dsb.addEventListener('click', function () { closeDr(true); openSearch(); });
    if (ham) ham.addEventListener('click', openDr);
    if (dc)  dc.addEventListener('click', function () { closeDr(); });
    if (ov)  ov.addEventListener('click', function () { closeDr(); });

    // ── Active nav link highlight ─────────────────────────────────
    // The page itself, else the longest menu link it sits under
    // (/cash-bids/iowa/ames is under /cash-bids). A link counts only on a
    // whole path part, so /rain does not light up on /rain-print.
    var path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    var navLinks = document.querySelectorAll('[data-nav-link], .nav-panel a, .drawer-link, .draw-item');
    var best = '';
    navLinks.forEach(function (a) {
      var href = (a.getAttribute('href') || '').split(/[?#]/)[0].replace(/\/$/, '') || '/';
      if (href !== '/' && (href === path || path.indexOf(href + '/') === 0) && href.length > best.length) best = href;
    });
    if (best) navLinks.forEach(function (a) {
      var href = (a.getAttribute('href') || '').split(/[?#]/)[0].replace(/\/$/, '') || '/';
      if (href === best) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    });

    initPlace();
    initMoved();
    initEmailButton();
    try { if (window.AgsistSignup && window.AgsistSignup.scan) window.AgsistSignup.scan(); } catch (e) {}

    // ── Keyboard: Escape closes drawer/dropdowns ──────────────────
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.nav-dd').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('.nav-btn');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
        closeDr();
      }
    });

    // ── Sticky nav scroll class ───────────────────────────────────
    window.addEventListener('scroll', function () {
      var nav = document.getElementById('topnav');
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 10);
    }, { passive: true });

    // ── Call any page-level post-nav hook ─────────────────────────
    if (typeof window.onNavReady === 'function') window.onNavReady();
  }

  // ── Saved place: the ZIP chip and the phone panel's My place row (2026-10-18) ──
  // Reads the keys the pages already use: agsist-wx-loc (geo.js: zip, state,
  // county, lat, lon, label "Town, ST"), else agsist_user_zip (the harvest
  // tools, futures pages), else agsist_zip (cash bids, the Daily box). Saving
  // a ZIP here writes all three, the way geo.js saves a typed ZIP, so bids,
  // rain, rent and the signup box pick it up. The town comes from the same
  // ZIP lookup geo.js uses (Open-Meteo); nothing else is sent anywhere.
  function byId(id) { return document.getElementById(id); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  var ST_CODE = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' };
  // States with a /rent/<state> page (no Alaska, Hawaii or Rhode Island page).
  var RENT_ST = {};
  for (var stName in ST_CODE) if (!/^(alaska|hawaii|rhode island|district of columbia)$/.test(stName)) RENT_ST[ST_CODE[stName]] = stName.replace(/ /g, '-');
  function readPlace() {
    var o = null;
    try { o = JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (o && /^\d{5}$/.test(String(o.zip || ''))) {
      var town = String(o.label || '').split(',')[0].trim();
      if (/\d/.test(town) || town.length > 28) town = '';
      return { zip: String(o.zip), state: /^[A-Z]{2}$/.test(String(o.state || '')) ? o.state : '', town: town };
    }
    var z = String(lsGet('agsist_user_zip') || lsGet('agsist_zip') || '');
    return /^\d{5}$/.test(z) ? { zip: z, state: '', town: '' } : null;
  }
  function paintPlace() {
    var p = readPlace(), where = p ? (p.town || p.zip) : '';
    var t = byId('zip-chip-t'), chip = byId('zip-chip');
    if (t) t.textContent = p ? 'Bids near ' + where : 'Set your ZIP';
    if (chip) chip.setAttribute('aria-label', p ? 'Bids near ' + (p.town ? p.town + ', ZIP ' + p.zip : 'ZIP ' + p.zip) + '. Change your ZIP' : 'Set your ZIP');
    var bids = byId('dp-bids'), rent = byId('dp-rent'), dz = byId('dp-zip'), here = byId('dp-here');
    // Fast Facts (was /here, Oct 21): one page for a place (bids, rain, hail, drought, rent). Sig, Oct 20: the
    // first My place tile, and where the ZIP box sends a reader once a ZIP is saved.
    if (here) here.setAttribute('href', p ? '/fast-facts?zip=' + p.zip : '/fast-facts');
    if (bids) bids.setAttribute('href', p ? '/cash-bids?zip=' + p.zip : '/cash-bids');
    if (rent) rent.setAttribute('href', p && RENT_ST[p.state] ? '/rent/' + RENT_ST[p.state] + '#your-ground' : '/rent/');
    if (dz) dz.textContent = p ? where + (p.town ? ' ' + p.zip : '') : 'no ZIP set';
    var go = byId('zip-go'), links = byId('zip-links');
    if (go) { go.setAttribute('href', p ? '/fast-facts?zip=' + p.zip : '/fast-facts'); go.textContent = p ? 'Everything near ' + where + ' →' : ''; }
    if (links) links.hidden = !p;
  }
  function saveZip(z, done) {
    var prior = null;
    try { prior = JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) { prior = null; }
    fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + z + '&count=1&language=en&format=json&countryCode=US')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var r = d && d.results && d.results[0];
        if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') { done(false, 'none'); return; }
        // As geo.js: Open-Meteo can give the ZIP as the name; then no town is printed rather than a wrong one.
        var isZip = /^\d+$/.test(String(r.name || '').trim());
        var st = ST_CODE[String(r.admin1 || '').trim().toLowerCase()] || '';
        var city = isZip ? '' : String(r.name || '');
        var rec = { lat: r.latitude, lon: r.longitude, label: city ? city + (st ? ', ' + st : '') : z, ts: Date.now(),
                    zip: z, state: st, county: prior && prior.zip === z ? (prior.county || '') : '', zipTyped: true };
        lsSet('agsist-wx-loc', JSON.stringify(rec));
        lsSet('agsist_zip', z); lsSet('agsist_user_zip', z);
        done(true);
      })
      .catch(function () { done(false, 'net'); });
  }
  function initPlace() {
    paintPlace();
    var chip = byId('zip-chip'), pop = byId('zip-pop'), f = byId('zip-f'), inp = byId('zip-in'), m = byId('zip-m'), clr = byId('zip-clear');
    if (!chip || !pop || !f || !inp) return;
    function open() {
      document.querySelectorAll('.nav-dd.open').forEach(function (d) { d.classList.remove('open'); var t = d.querySelector('.nav-btn'); if (t) t.setAttribute('aria-expanded', 'false'); });
      var p = readPlace();
      inp.value = p ? p.zip : '';
      if (m) m.textContent = '';
      pop.hidden = false; chip.setAttribute('aria-expanded', 'true');
      setTimeout(function () { inp.focus(); if (inp.select) inp.select(); }, 0);
    }
    function close(back) {
      if (pop.hidden) return;
      pop.hidden = true; chip.setAttribute('aria-expanded', 'false');
      if (back) chip.focus();
    }
    chip.addEventListener('click', function (e) { e.stopPropagation(); if (pop.hidden) open(); else close(true); });
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { close(false); });
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.addEventListener('click', function () { close(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) close(true); });
    pop.addEventListener('focusout', function (e) { var to = e.relatedTarget; if (to && !pop.contains(to) && to !== chip) close(false); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var z = String(inp.value || '').replace(/\D/g, '');
      if (!/^\d{5}$/.test(z)) { if (m) m.textContent = 'Type a 5-digit ZIP.'; inp.focus(); return; }
      var p = readPlace();
      if (p && p.zip === z && p.town) { lsSet('agsist_zip', z); lsSet('agsist_user_zip', z); paintPlace(); if (m) m.textContent = 'Saved: ' + p.town + ' ' + z + '.'; return; }
      if (m) m.textContent = 'Looking up ' + z + '…';
      saveZip(z, function (ok, why) {
        if (!ok) { if (m) m.textContent = why === 'net' ? 'The ZIP lookup did not answer. Nothing was saved; try again in a minute.' : 'Couldn’t find ZIP ' + z + '. Check the number.'; return; }
        paintPlace();
        var q = readPlace();
        if (m) m.textContent = 'Saved: ' + ((q && q.town) ? q.town + ' ' : '') + z + '. Bids, rain and rent pages start there.';
      });
    });
    if (clr) clr.addEventListener('click', function () {
      lsDel('agsist-wx-loc'); lsDel('agsist_zip'); lsDel('agsist_user_zip');
      paintPlace(); inp.value = ''; if (m) m.textContent = 'Your ZIP is cleared from this browser.'; inp.focus();
    });
    window.addEventListener('storage', paintPlace);
    window.addEventListener('focus', paintPlace);
  }

  // "Harvest tools moved to Field": a one-line note in the Money & Land menu
  // for two weeks after the Oct 18 menu (until the data-until date, Central
  // time), until the reader closes it.
  function initMoved() {
    var KEY = 'agsist_nav_moved_x', off = lsGet(KEY) === '1', now = Date.now();
    var notes = document.querySelectorAll('[data-nav-moved]');
    Array.prototype.forEach.call(notes, function (p) {
      var end = Date.parse((p.getAttribute('data-until') || '2026-11-01') + 'T00:00:00-05:00');
      if (off || !(now < end)) { p.hidden = true; return; }
      p.hidden = false;
      var x = p.querySelector('.nav-moved-x');
      if (x) x.addEventListener('click', function () {
        lsSet(KEY, '1');
        var next = p.parentNode && p.parentNode.querySelector('a[href]');
        Array.prototype.forEach.call(notes, function (q) { q.hidden = true; });
        if (next) next.focus();
      });
    });
  }

  function signedUp() {
    try { return lsGet('agsist_subscribed') === '1' || /(^|;\s*)agsist_subscribed=/.test(document.cookie); } catch (e) { return false; }
  }
  // Free daily email: opens the Daily panel at its signup box. A subscriber
  // sees neither the button nor the menu's signup boxes.
  function initEmailButton() {
    if (signedUp()) {
      document.querySelectorAll('#topnav [data-signup-hide], #drawer [data-signup-hide]').forEach(function (el) { el.hidden = true; });
      return;
    }
    var b = byId('nav-email'), dd = byId('dd-daily');
    if (!b || !dd) return;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var t = dd.querySelector('.nav-btn');
      if (!dd.classList.contains('open') && t) t.click();
      /* The panel fades in, and it is hidden until its fade starts at a frame: on a busy phone or laptop the one try
         at 60 ms came first, the box could not take the focus, and the button left the reader with nothing in focus
         (2026-10-22; test/nav-full-oct18.test.mjs). Try each frame until the box has it, while the panel stays open. */
      setTimeout(function () {
        var n = 0;
        (function go() {
          if (!dd.classList.contains('open')) return;
          var inp = dd.querySelector('.nav-ask input[type="email"]');
          if (inp) { inp.focus(); if (document.activeElement === inp) return; }
          if (++n < 120) requestAnimationFrame(go);
        })();
      }, 60);
    });
  }

  // Rain Print pages hide the footer's /sponsor link in their own styles (no
  // sponsor on those pages, Sig 2026-10-15). That rule is written against
  // #site-footer, which holds the no-script footer until the live one replaces
  // it, so it is read there first (pageHidesSponsor, before the swap); the
  // live footer's sponsor links (Advertise, PRF sponsor: data-sponsor-link)
  // and the supporter strip then go too.
  function pageHidesSponsor() {
    var a = document.querySelector('#site-footer a[href^="/sponsor"]');
    try { return !!a && window.getComputedStyle(a).display === 'none'; } catch (e) { return false; }
  }
  function footerSponsorHide(hide) {
    var foot = document.querySelector('footer.footer');
    if (!foot || !hide) return;
    foot.querySelectorAll('[data-sponsor-link], #footer-adspace').forEach(function (a) { a.style.setProperty('display', 'none', 'important'); });
  }

  // Footer Ad Space showcase. Live lifetime view counter (Cloudflare Worker + KV)
  // plus sponsor slot-fill from /data/supporters.json.
  var COUNTER_URL = ''; // <-- set to your deployed worker URL ('' disables; the old agsist-counter worker is gone, so this stops a failed request + console error on every page)
  function renderSupporters() {
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    // 1) live lifetime footer-view counter (Worker increments + returns total)
    if (COUNTER_URL) {
      fetch(COUNTER_URL, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) {
          var n = Number(d && d.views);
          var el = document.querySelector('[data-adviews]');
          if (el && isFinite(n) && n > 0) el.textContent = n.toLocaleString('en-US');
        })
        .catch(function () { /* keep the static fallback shown in the footer */ });
    }
    // 2) the footer strip shows ONLY active supporters (2026-10-11, Sig:
    //    "tone it down"). It ships hidden and empty; with no active supporter,
    //    or on any failure, it stays hidden. No open slot, no price, no pulse.
    var row = document.getElementById('adspace-row');
    if (!row) return;
    var strip = document.getElementById('footer-adspace');
    fetch(BASE + '/data/supporters.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var ctaUrl = (d && d.cta_url) || '/sponsor#slots';
        var list = ((d && d.supporters) || []).filter(function (s) { return s && s.active === true; });
        if (!list.length) return;
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          var url = s.url || ctaUrl;
          if (!/^(https?:\/\/|\/)/.test(url)) url = ctaUrl;
          var ext = url.indexOf('http') === 0;
          var a = document.createElement('a');
          a.className = 'ad-slot ad-slot--filled';
          a.href = url;
          if (ext) { a.target = '_blank'; a.rel = 'sponsored noopener'; }
          else { a.rel = 'sponsored'; }
          a.innerHTML = supporterInner(s);
          // MEASURED BY components/sponsor-metrics.js, NOT HERE.
          // This card is only ever built for an ACTIVE supporter, so it is a
          // real ad and counts as one. The old inline supporter_click listener
          // was DELETED in the same edit that added these attributes -- leaving
          // both would have counted every click twice.
          a.setAttribute('data-sponsor-slot', 'footer-strip');
          a.setAttribute('data-sponsor-click', 'footer-strip');
          row.appendChild(a);
        }
        if (strip) strip.hidden = false;
      })
      .catch(function () { /* the strip stays hidden */ });
  }

  // ── Sold page slots (2026-10-07) ───────────────────────────────
  // Each tool page ships its ribbon markup ("Sponsor this page", price,
  // button), HIDDEN by components/styles.css until sold (2026-10-11).
  // When a sponsor has bought that page, data/page-sponsors.json carries them
  // under the ribbon's slot id, written by scripts/sponsor_apply.py once Sig
  // approves. From the entry's start date (Central time) the open ribbon is
  // replaced by theirs and shown. Any failure leaves the ribbon hidden: an
  // unsold slot shows nothing.
  // ONE RENDERER for a sold slot, shared with the sign-up form's live preview
  // (sponsor-apply.html calls window.AgsistSlots), so what a sponsor sees
  // before they apply is what the site draws after Sig approves.
  function slotEsc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ribbonInner(sp, id, live) {
    var href = sp.url + (sp.url.indexOf('?') < 0 ? '?' : '&') +
      'utm_source=agsist&utm_medium=page-ribbon&utm_campaign=' + encodeURIComponent(id);
    // Live: only a logo that went through the approval job (/img/sponsors/).
    // Preview: the data: URL the applicant just picked.
    var okLogo = live ? /^\/img\/sponsors\/[a-z0-9._-]+\.(png|jpe?g|webp)$/.test(sp.logo || '')
                      : /^data:image\/(png|jpeg|webp);base64,/.test(sp.logo || '');
    var logo = okLogo ? '<img class="ag-sponsor-logo" src="' + slotEsc(sp.logo) + '" alt="" loading="lazy">' : '';
    return '<span class="ag-sponsor-tag">Sponsor</span>' + logo +
      '<span class="ag-sponsor-copy"><b>' + slotEsc(sp.company) + '</b>' +
      (sp.headline ? ', ' + slotEsc(sp.headline) : '') + (sp.body ? ' <span>' + slotEsc(sp.body) + '</span>' : '') +
      '</span><a href="' + slotEsc(href) + '" rel="sponsored noopener" target="_blank"' +
      (live ? ' data-sponsor-click="page:' + slotEsc(id) + '"' : '') + '>Visit &rarr;</a>';
  }
  function supporterInner(s) {
    var inner = s.logo
      ? '<img class="ad-filled-logo" src="' + slotEsc(s.logo) + '" alt="' + slotEsc(s.name) + '">'
      : '<span class="ad-filled-name">' + slotEsc(s.name) + '</span>';
    return '<span class="ad-slot-tag ad-slot-tag--live">Sponsor</span>' + inner +
      (s.blurb ? '<span class="ad-filled-blurb">' + slotEsc(s.blurb) + '</span>' : '');
  }
  window.AgsistSlots = { ribbon: function (sp, id) { return ribbonInner(sp, id, false); }, supporter: supporterInner };

  function fillPageRibbons() {
    var rib = document.querySelector('aside.ag-sponsor-ribbon');
    if (!rib) return;
    // An unsold ribbon ships empty with only data-slot (Sig, 2026-10-19: no
    // price text in the page; scripts/stamp_rates.py writes it). A page cached
    // from before that still carries the slot in its link.
    var id = rib.getAttribute('data-slot') || '';
    if (!/^[a-z0-9-]+$/.test(id)) {
      var a = rib.querySelector('a[href*="slot="]');
      var m = a && /[?&]slot=([a-z0-9-]+)/.exec(a.getAttribute('href') || '');
      if (!m) return;
      id = m[1];
    }
    fetch(BASE + '/data/page-sponsors.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('page-sponsors'); return r.json(); })
      .then(function (d) {
        var sp = d && d.slots && d.slots[id];
        var today;
        try { today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()); }
        catch (e) { today = new Date().toISOString().slice(0, 10); }
        if (!sp || sp.active === false || !sp.company || !/^https?:\/\//.test(sp.url || '') ||
            !/^\d{4}-\d{2}-\d{2}$/.test(sp.start || '') || sp.start > today) return;
        rib.classList.add('ag-sponsor-ribbon--sold');
        rib.setAttribute('data-sponsor-slot', 'page:' + id);
        rib.setAttribute('aria-label', 'Sponsored: ' + sp.company);
        rib.innerHTML = ribbonInner(sp, id, true);
      })
      .catch(function () { /* the ribbon stays hidden */ });
  }

  // ── Sponsor measurement ────────────────────────────────────────
  // A tracker nobody loads is a draft. Every page pulls this loader, so this
  // is the one place that puts sponsor-metrics.js on every page. It is
  // deferred behind the chrome because nothing it measures exists until the
  // footer is injected, and it watches for that itself.
  function loadSponsorMetrics() {
    if (window.__sponsorMetrics) return;
    window.__sponsorMetrics = true;
    var s = document.createElement('script');
    s.src = BASE + cv('/components/sponsor-metrics.js');
    s.async = true;
    document.head.appendChild(s);
  }

  // ── Footer link sections ───────────────────────────────────────
  // footer.html ships each link column as <details open>, so every link is in
  // the HTML. Phones (700px and under) get them closed: five tap rows instead
  // of about 60 links. Wide screens keep them open and look as they did; a
  // click on a heading there does nothing, and the heading is not a tab stop.
  function foldFooter() {
    var foot = document.querySelector('footer.footer');
    if (!foot) return;
    var dets = foot.querySelectorAll('details.footer-col');
    if (!dets.length) return;
    var mq = null;
    try { mq = window.matchMedia('(max-width: 700px)'); } catch (e) {}
    function phone() { return !!(mq && mq.matches); }
    function apply() {
      var p = phone();
      for (var i = 0; i < dets.length; i++) {
        dets[i].open = !p;
        var s = dets[i].querySelector('summary');
        if (!s) continue;
        if (p) s.removeAttribute('tabindex'); else s.setAttribute('tabindex', '-1');
      }
    }
    apply();
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', apply);
      else if (mq.addListener) mq.addListener(apply);
    }
    foot.addEventListener('click', function (e) {
      if (phone()) return;
      var s = e.target && e.target.closest ? e.target.closest('summary') : null;
      if (s && foot.contains(s)) e.preventDefault();
    });
  }

  // Site search: components/search.js + search.css load on first open (the
  // header button, "/" or Ctrl/Cmd-K), never on page load. A focused stand-in
  // input holds the phone keyboard up until the real box takes focus.
  function openSearch() {
    if (window.AgsistSearch) { window.AgsistSearch.open(); return; }
    if (!window.__agsistSearchProxy) {
      var px = document.createElement('input');
      px.setAttribute('aria-hidden', 'true'); px.tabIndex = -1;
      px.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0';
      document.body.appendChild(px); px.focus();
      window.__agsistSearchProxy = px;
    }
    window.__agsistSearchWant = true;
    if (openSearch.loading) return;
    openSearch.loading = true;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BASE + cv('/components/search.css');
    l.onload = l.onerror = function () { // styles first, so the sheet never shows unstyled
      var s = document.createElement('script'); s.src = BASE + cv('/components/search.js');
      s.onerror = function () { openSearch.loading = false; var p = window.__agsistSearchProxy; if (p) p.remove(); window.__agsistSearchProxy = null; };
      document.head.appendChild(s);
    };
    document.head.appendChild(l);
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target, tag = t && t.tagName;
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) { e.preventDefault(); openSearch(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openSearch(); }
  });


  // Site notice (2026-10-21): one honest line about an outage, a bar fixed to the bottom of the screen, switched on and
  // off by data/site-notice.json alone, no release needed. {"active": true,
  // "id": "...", "text": "...", "link": "/rain-print"}. A reader can close it; it
  // stays closed for that id. No file, a bad file or active false: nothing shows.
  function siteNotice() {
    if (!window.fetch) return;
    // for people: an automated browser (crawlers, the test suite) gets the page as it is, unless ?notice=show
    if (navigator.webdriver === true && !/[?&]notice=show\b/.test(location.search)) return;
    fetch(BASE + '/data/site-notice.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (n) {
        if (!n || n.active !== true || typeof n.text !== 'string' || !n.text) return;
        var id = String(n.id || n.text).slice(0, 80);
        try { if (localStorage.getItem('agsist-notice-closed') === id) return; } catch (e) {}
        if (document.getElementById('site-notice')) return;
        var bar = document.createElement('div');
        bar.id = 'site-notice';
        bar.setAttribute('role', 'status');
        bar.style.cssText = 'background:#7a4b00;color:#fff;font-size:0.92rem;line-height:1.4;padding:8px 44px 8px 16px;position:fixed;left:0;right:0;bottom:0;z-index:9980;text-align:center;box-shadow:0 -2px 8px rgba(0,0,0,.25)';
        var msg = document.createElement('span');
        msg.textContent = n.text;
        bar.appendChild(msg);
        if (typeof n.link === 'string' && /^\/[A-Za-z0-9/_#?=.-]*$/.test(n.link)) {
          var a = document.createElement('a');
          a.href = n.link; a.textContent = ' More'; a.style.cssText = 'color:#fff;text-decoration:underline;margin-left:6px';
          bar.appendChild(a);
        }
        var x = document.createElement('button');
        x.type = 'button'; x.setAttribute('aria-label', 'Close this notice'); x.textContent = '×';
        x.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;color:#fff;font-size:1.3rem;cursor:pointer;padding:4px 8px';
        x.addEventListener('click', function () {
          try { localStorage.setItem('agsist-notice-closed', id); } catch (e) {}
          bar.remove();
          document.body.style.paddingBottom = '';
        });
        bar.appendChild(x);
        // fixed to the bottom of the screen, so nothing on the page moves when it lands
        document.body.appendChild(bar);
        // room under the last of the page, so the bar never sits on its final buttons
        document.body.style.paddingBottom = bar.offsetHeight + 'px';
      })
      .catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectAnalytics();
    siteNotice();
    loadSponsorMetrics();
    loadComponent('site-header', '/components/header.html', initNav);
    var noSponsor = pageHidesSponsor();
    loadComponent('site-footer', '/components/footer.html', function () {
      foldFooter(); renderSupporters(); footerSponsorHide(noSponsor);
      try { if (window.AgsistSignup && window.AgsistSignup.scan) window.AgsistSignup.scan(); } catch (e) {}
    });
    fillPageRibbons();
    (function () { if (!document.querySelector('link[href*="/components/states.css"]')) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BASE + '/components/states.css?v=2'; document.head.appendChild(l); } if (!window.AgStates && !document.querySelector('script[src*="/components/states.js"]')) { var j = document.createElement('script'); j.src = BASE + '/components/states.js?v=1'; j.async = true; document.head.appendChild(j); } })(); // loading, empty, error and stale states kit (components/states.css + states.js), on every page
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// AGSIST Timer Module (v15) — auto-ticking freshness signals across the site.
//
// Three modes, all bound via either HTML data-attributes OR window.agsistTimer.set():
//
//   1. live      — data is refreshed on a cron interval. Pulses green when fresh,
//                  goes gold STALE at 1.5× interval, red OFFLINE at 3×.
//                  Required: target/fetched (ISO) + interval (minutes)
//                  Output: "● Markets 5m ago · next ~25m"
//
//   2. since     — show how long since a fixed past event. No state coloring.
//                  Required: target (ISO timestamp in past)
//                  Output: "Published 3h ago"
//
//   3. countdown — show how long until a fixed future event.
//                  Required: target (ISO timestamp in future)
//                  Output: "Next WASDE · in 7d 3h"
//
// HTML usage (auto-discovered on DOMContentLoaded):
//   <span data-agsist-timer data-mode="live" data-target="2026-04-29T12:00Z"
//         data-interval="30" data-label="Markets"></span>
//
// JS usage (when target comes from a fetch, not HTML):
//   window.agsistTimer.set(el, {mode:'live', fetched:data.fetched, interval:30, label:'Markets'});
//   window.agsistTimer.set(el, {mode:'since', target:isoStr, label:'Published', showNext:false});
//
// Public API:
//   window.agsistTimer.set(el, opts)  — bind/rebind a single element (idempotent)
//   window.agsistTimer.refresh()      — re-render all bound elements immediately
//   window.agsistTimer.scan()         — re-scan DOM for new [data-agsist-timer] spans
//
// Renders preserve any existing non-agt classes on the element (e.g. .snap-age,
// .dv3-publish-age) so page-specific font-size/color rules continue to apply.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var POLL_MS = 30000;          // tick all timers every 30 seconds
  var RESCAN_DELAY_MS = 1000;   // re-scan once after 1s for late-injected spans
  var registry = [];            // [{el, mode, target (ISO string), interval (min), label, showNext}]
  var pollHandle = null;
  var styleInjected = false;

  // XSS-safe HTML escape — labels are the only string we interpolate into innerHTML
  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // One-time CSS injection. Uses CSS variables with hex fallbacks so the timer
  // renders correctly even if /components/styles.css hasn't loaded yet.
  function injectStyles() {
    if (styleInjected) return;
    if (document.getElementById('agt-styles')) { styleInjected = true; return; }
    var css =
      '.agt{display:inline-flex;align-items:center;gap:6px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:inherit;line-height:1.2;color:inherit;white-space:nowrap}' +
      '.agt-dot{display:inline-block;width:6px;height:6px;border-radius:50%;flex-shrink:0}' +
      '.agt-dot-live{background:var(--green,#3a8b3c);animation:agt-pulse 2s ease-in-out infinite}' +
      '.agt-dot-stale{background:var(--gold-fill,var(--gold,#daa520))}' +
      '.agt-dot-offline{background:var(--red,#c8322e)}' +
      '.agt-stale{color:var(--gold,#daa520)}' +
      '.agt-offline{color:var(--red,#c8322e)}' +
      '.agt-tag{font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.92em}' +
      '.agt-next{opacity:.55;margin-left:2px}' +
      '@keyframes agt-pulse{0%,100%{opacity:1}50%{opacity:.35}}' +
      '@media(prefers-reduced-motion:reduce){.agt-dot-live{animation:none}}';
    var style = document.createElement('style');
    style.id = 'agt-styles';
    style.textContent = css;
    if (document.head) document.head.appendChild(style);
    styleInjected = true;
  }

  // Format helpers — compact "X ago" / "in X" with day/hour/minute granularity.
  function relAgo(absMin) {
    if (absMin < 1) return 'just now';
    if (absMin < 60) return absMin + 'm ago';
    if (absMin < 24 * 60) {
      var hr = Math.floor(absMin / 60);
      var mn = absMin % 60;
      return mn > 0 && hr < 4 ? hr + 'h ' + mn + 'm ago' : hr + 'h ago';
    }
    var d = Math.floor(absMin / (24 * 60));
    var h = Math.floor((absMin % (24 * 60)) / 60);
    return h > 0 && d < 3 ? d + 'd ' + h + 'h ago' : d + 'd ago';
  }
  function relIn(absMin) {
    if (absMin < 1) return 'now';
    if (absMin < 60) return 'in ' + absMin + 'm';
    if (absMin < 24 * 60) {
      var hr = Math.floor(absMin / 60);
      var mn = absMin % 60;
      return mn > 0 && hr < 4 ? 'in ' + hr + 'h ' + mn + 'm' : 'in ' + hr + 'h';
    }
    var d = Math.floor(absMin / (24 * 60));
    var h = Math.floor((absMin % (24 * 60)) / 60);
    return h > 0 && d < 3 ? 'in ' + d + 'd ' + h + 'h' : 'in ' + d + 'd';
  }

  // Render a single registry entry. Returns false if the element is gone (so
  // tickAll can prune it from the registry).
  function renderEntry(entry) {
    if (!entry.el || !entry.el.isConnected) return false;
    var targetMs = new Date(entry.target).getTime();
    if (isNaN(targetMs)) { entry.el.textContent = ''; return true; }
    var nowMs = Date.now();
    var diffMs = nowMs - targetMs; // positive = past, negative = future
    var ageMin = Math.round(diffMs / 60000);
    var html = '';
    var stateClasses = ['agt'];

    if (entry.mode === 'live') {
      var iv = entry.interval || 30;
      if (ageMin < 0) ageMin = 0;
      var stalenessRatio = ageMin / iv;
      var labelHtml = entry.label ? escHtml(entry.label) + ' ' : '';
      if (stalenessRatio >= 3) {
        stateClasses.push('agt-offline');
        html = '<span class="agt-dot agt-dot-offline"></span><span class="agt-tag">delayed</span> · ' +
               labelHtml + relAgo(ageMin);
      } else if (stalenessRatio >= 1.5) {
        stateClasses.push('agt-stale');
        html = '<span class="agt-dot agt-dot-stale"></span><span class="agt-tag">stale</span> · ' +
               labelHtml + relAgo(ageMin);
      } else {
        stateClasses.push('agt-live');
        var ageText = ageMin < 1 ? 'live' : labelHtml + relAgo(ageMin);
        html = '<span class="agt-dot agt-dot-live"></span>' + ageText;
        if (entry.showNext !== false) {
          var nextMin = Math.max(0, iv - ageMin);
          if (nextMin > 0) html += '<span class="agt-next">· next ~' + nextMin + 'm</span>';
        }
      }
    } else if (entry.mode === 'since') {
      stateClasses.push('agt-since');
      var sinceLabel = entry.label ? escHtml(entry.label) + ' ' : '';
      html = sinceLabel + relAgo(Math.max(0, ageMin));
    } else if (entry.mode === 'countdown') {
      stateClasses.push('agt-countdown');
      var cdLabel = entry.label ? escHtml(entry.label) + ' · ' : '';
      var absM = Math.abs(ageMin);
      html = cdLabel + (diffMs >= 0 ? relAgo(absM) : relIn(absM));
    } else {
      return true;
    }

    // Preserve any existing non-agt classes (e.g. .snap-age, .dv3-publish-age)
    // so page-specific styling rules continue to apply.
    var rawCls = (typeof entry.el.className === 'string') ? entry.el.className : '';
    var existing = rawCls.split(/\s+/).filter(function (c) {
      return c && !/^agt(-[\w]+)?$/.test(c);
    });
    entry.el.className = existing.concat(stateClasses).join(' ');
    entry.el.innerHTML = html;
    return true;
  }

  // Tick all + prune dead entries.
  function tickAll() {
    var alive = [];
    for (var i = 0; i < registry.length; i++) {
      if (renderEntry(registry[i])) alive.push(registry[i]);
    }
    registry = alive;
    if (registry.length === 0 && pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  function ensurePoll() {
    if (pollHandle || registry.length === 0) return;
    pollHandle = setInterval(tickAll, POLL_MS);
  }

  // Public API ----------------------------------------------------------------
  function set(el, opts) {
    if (!el || !opts) return;
    injectStyles();
    var target = opts.target || opts.fetched;
    if (!target) return;
    var entry = {
      el: el,
      mode: opts.mode || 'since',
      target: target,
      interval: opts.interval,
      label: opts.label,
      showNext: opts.showNext !== false
    };
    // Idempotent — replace any existing entry for this element
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].el === el) { registry.splice(i, 1); break; }
    }
    registry.push(entry);
    if (el.style && el.style.display === 'none') el.style.display = '';
    renderEntry(entry);
    ensurePoll();
  }

  function refresh() { tickAll(); }

  function scanAttrs() {
    injectStyles();
    var nodes = document.querySelectorAll('[data-agsist-timer]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var target = el.getAttribute('data-target') || el.getAttribute('data-fetched');
      if (!target) continue; // wait for programmatic .set() to provide the target
      var bound = false;
      for (var j = 0; j < registry.length; j++) {
        if (registry[j].el === el) { bound = true; break; }
      }
      if (bound) continue;
      var mode = el.getAttribute('data-mode') || 'since';
      var intervalAttr = el.getAttribute('data-interval');
      var interval = intervalAttr ? parseInt(intervalAttr, 10) : undefined;
      var label = el.getAttribute('data-label') || '';
      var showNext = el.getAttribute('data-show-next') !== 'false';
      set(el, {mode: mode, target: target, interval: interval, label: label, showNext: showNext});
    }
  }

  window.agsistTimer = {
    set: set,
    refresh: refresh,
    scan: scanAttrs
  };

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAttrs);
  } else {
    scanAttrs();
  }
  // Catch late-injected timer spans (e.g. from briefing strip fetches)
  setTimeout(scanAttrs, RESCAN_DELAY_MS);
})();

// ── AGSIST Daily signup asks, sitewide ────────────────────────────────
// 2026-10-06: the corner pill that lived here is replaced by
// components/signup-ask.js, which owns every signup ask on the site: the
// second-visit bar (visit 2 on, not for subscribers, 35 days after a close),
// the one-line page asks (<div data-signup-ask="...">), ?ref=email-forward,
// and the success rule (HTTP ok AND data.ok === true). The homepage loads it
// directly, under the hero; every other page gets it from here.
(function () {
  if (window.AgsistSignup || document.querySelector('script[src*="/components/signup-ask.js"]')) return;
  var s = document.createElement('script');
  s.src = '/components/signup-ask.js?v=15';
  s.async = true;
  (document.head || document.documentElement).appendChild(s);
})();


/* ── LOADING STATES ────────────────────────────────────────────────────────
   258 elements across 20 pages ship as a bare em-dash and wait for a fetch.
   This turns each of them into a skeleton until its value lands, then flashes
   the ones that change afterwards.

   Applied here rather than in markup for two reasons: 20 pages of hand-edits
   drift apart -- that is the whole reason this file exists -- and any page
   written later gets it for free.

   Rules it follows:
     - Only an element with an id whose entire text is a dash. Anything else is
       content, not a placeholder.
     - Everything settles by SK_TIMEOUT whatever happens. A value that never
       arrives falls back to the dash, because "no number" is a real answer and
       a skeleton that never resolves is a lie about it.
     - The first change is the value landing (fade in). Later changes are the
       number moving (flash green or red). They are not the same event and do
       not get the same treatment.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  var SK_TIMEOUT = 6000;                 // hard stop; nothing shimmers past this
  var DASH = /^[\s—–\-]+$/;    // em dash, en dash, hyphen, or spaces
  var NUM  = /-?[\d][\d,]*(?:\.\d+)?/;

  function isPlaceholder(el) {
    if (!el.id) return false;
    if (el.children.length) return false;
    return DASH.test(el.textContent || '');
  }

  function numberIn(t) {
    var m = String(t == null ? '' : t).replace(/[−]/g, '-').match(NUM);
    return m ? parseFloat(m[0].replace(/,/g, '')) : null;
  }

  function start() {
    var marked = [];
    var els = document.querySelectorAll('[id]');
    for (var i = 0; i < els.length; i++) {
      if (isPlaceholder(els[i])) { els[i].classList.add('sk'); marked.push(els[i]); }
    }
    if (!marked.length) return;

    var seen = new WeakMap();            // el -> last settled value
    var done = false;

    function settle(el, flash) {
      if (!el.classList.contains('sk') && !flash) return;
      el.classList.remove('sk');
      if (flash == null) { el.classList.add('sk-in'); setTimeout(function(){ el.classList.remove('sk-in'); }, 300); return; }
      var c = flash > 0 ? 'sk-up' : 'sk-dn';
      el.classList.remove('sk-up', 'sk-dn');
      void el.offsetWidth;               // restart the animation on a repeat move
      el.classList.add(c);
      setTimeout(function(){ el.classList.remove(c); }, 1000);
    }

    var obs = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var el = recs[i].target;
        el = el.nodeType === 1 ? el : el.parentElement;
        while (el && !el.id) el = el.parentElement;
        if (!el) continue;
        if (!el.classList.contains('sk') && !seen.has(el)) continue;
        var txt = el.textContent || '';
        if (DASH.test(txt)) continue;    // still a placeholder; keep waiting
        var now = numberIn(txt);
        var was = seen.get(el);
        if (was === undefined) { settle(el, null); }
        else if (now !== null && was !== null && now !== was) { settle(el, now > was ? 1 : -1); }
        seen.set(el, now);
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });

    function sweep() {
      var left = document.querySelectorAll('.sk');
      for (var i = 0; i < left.length; i++) left[i].classList.remove('sk');
    }
    // Sweep the document, not the list we built: a page that re-renders a node
    // hands us a fresh element carrying the class we can no longer reach by
    // reference. Twice, because a late fetch can land between the two.
    setTimeout(sweep, SK_TIMEOUT);
    setTimeout(function () { done = true; obs.disconnect(); sweep(); }, SK_TIMEOUT + 2000);
  }

  if (window.__agsistSkeletons) return;   // loader.js included twice is not two skeleton passes
  window.__agsistSkeletons = 1;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

// ─────────────────────────────────────────────────────────────────────────────
// Instant pages (2026-10-09). Chrome and Edge get speculation rules: a link
// held under the pointer (or touched) for a moment is loaded and drawn in the
// background, so the click opens it at once. Other browsers (Safari, Firefox)
// get a light prefetch of the page's HTML on touch or hover, a few per page.
// Skipped: other sites, mailto/tel, downloads, new-tab links, /sponsor-apply,
// and any link whose address subscribes, confirms or carries a token. Nothing
// is fetched ahead on Save-Data or a 2G connection.
// A page loaded ahead does not count as a visit: the analytics guard in each
// page's <head> holds Google's script until the page is actually shown.
(function () {
  'use strict';
  if (window.__agsistInstant) return;   // loader.js included twice
  window.__agsistInstant = 1;

  var SKIP_SEL = 'a[download],a[target="_blank"],a[rel~="nofollow"],a[data-no-prefetch],' +
    'a[href^="#"],a[href^="/sponsor-apply"],a[href*="subscribe"],a[href*="confirm"],' +
    'a[href*="token="],a[href*="action="],a[href*="utm_"],a[href^="/data/"],a[href^="/api/"]';
  var FILE_RE = /\.(pdf|csv|ics|xml|json|zip|txt|png|jpe?g|webp|gif|svg|xlsx?)$/i;

  function lowData() {
    try {
      var c = navigator.connection;
      if (!c) return false;
      return !!c.saveData || /(^|-)2g$/.test(c.effectiveType || '');
    } catch (e) { return false; }
  }

  // Back and forward come straight from the browser's page cache; a fade there
  // only delays the page the reader already saw. Fade on link clicks only.
  try {
    window.addEventListener('pageswap', function (e) {
      var t = e.activation && e.activation.navigationType;
      if (e.viewTransition && t === 'traverse') e.viewTransition.skipTransition();
    });
  } catch (e) {}

  function supportsRules() {
    try { return !!(HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')); }
    catch (e) { return false; }
  }

  if (supportsRules()) {
    // Chrome itself skips speculation on Save-Data and low memory.
    var where = { and: [
      { href_matches: '/*' },
      { not: { href_matches: ['/*.pdf', '/*.csv', '/*.ics', '/*.xml', '/*.json', '/*.zip', '/*.txt'] } },
      { not: { selector_matches: SKIP_SEL } }
    ] };
    var s = document.createElement('script');
    s.type = 'speculationrules';
    s.textContent = JSON.stringify({
      prerender: [{ source: 'document', where: where, eagerness: 'moderate' }],
      prefetch: [{ source: 'document', where: where, eagerness: 'conservative' }]
    });
    (document.head || document.documentElement).appendChild(s);
    return;
  }

  // Fallback: fetch the page's HTML once on touch or hover so the tap that
  // follows is served from cache. At most MAX pages per page view.
  var MAX = 4, done = {}, count = 0, hoverTimer = null;
  var linkPrefetch = (function () {
    try { var l = document.createElement('link'); return !!(l.relList && l.relList.supports && l.relList.supports('prefetch')); }
    catch (e) { return false; }
  })();

  function eligible(a) {
    if (!a || !a.href || a.matches(SKIP_SEL)) return null;
    var u;
    try { u = new URL(a.href, location.href); } catch (e) { return null; }
    if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return null;
    if (FILE_RE.test(u.pathname)) return null;
    u.hash = '';
    var key = u.href;
    if (key === location.href.split('#')[0]) return null;
    return key;
  }

  function prefetch(a) {
    if (count >= MAX || lowData()) return;
    var key = eligible(a);
    if (!key || done[key]) return;
    done[key] = 1; count++;
    if (linkPrefetch) {
      var l = document.createElement('link');
      l.rel = 'prefetch'; l.href = key; l.as = 'document';
      document.head.appendChild(l);
    } else {
      try { fetch(key, { credentials: 'same-origin', headers: { 'Accept': 'text/html' }, priority: 'low' }).catch(function () {}); }
      catch (e) {}
    }
  }

  function anchorOf(e) { return e.target && e.target.closest ? e.target.closest('a[href]') : null; }

  document.addEventListener('touchstart', function (e) { prefetch(anchorOf(e)); }, { passive: true, capture: true });
  document.addEventListener('mouseover', function (e) {
    var a = anchorOf(e);
    if (!a) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { prefetch(a); }, 80);   // a pass over the link is not a hover
  }, { passive: true, capture: true });
  document.addEventListener('mouseout', function () { clearTimeout(hoverTimer); }, { passive: true, capture: true });
})();

// Service worker: registered here so every page that loads this file gets it
// (until 2026-10-12 only the homepage registered it). Pages without loader.js
// load components/sw-register.js, the same block; the flag keeps it to once.
(function () {
  'use strict';
  var w = window, n = w.navigator;
  if (w.__agsistSW || !n || !('serviceWorker' in n)) return;
  w.__agsistSW = 1;
  try { if (w.self !== w.top) return; } catch (e) { return; }   // not from an embed
  if (w.isSecureContext === false) return;
  function go() {
    n.serviceWorker.register('/sw.js').catch(function (err) {
      try { console.warn('[AGSIST] service worker registration failed:', err); } catch (e) {}
    });
  }
  if (document.readyState === 'complete') go();
  else w.addEventListener('load', go, { once: true });

  // sw.js answers prices, bids, the daily brief and weather from the last
  // saved copy when the network fails or takes over 3 s, and posts a message.
  // components/asof.js turns that into its "Offline. Showing ..." line; a page
  // without asof.js gets this plain one, so a saved price is never shown as live.
  var NAMES = { prices: 'prices', bids: 'bids', daily: 'the daily brief', weather: 'weather' };
  var seen = {}, bar = null;
  function when(iso) {   // Central time, like components/asof.js
    var t = Date.parse(iso || '');
    if (isNaN(t)) return '';
    try {
      var day = function (x) { return new Date(x).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }); };
      var hm = new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
      return (day(t) === day(Date.now()) ? '' : day(t) + ', ') + hm + ' CT';
    } catch (e) { return ''; }
  }
  function paint(weak) {
    if (w.AgAsOf) return;
    var bits = [];
    for (var f in seen) bits.push(NAMES[f] + (seen[f] ? ' from ' + seen[f] : ''));
    if (!bits.length) return;
    if (!bar) {
      bar = document.createElement('p');
      bar.className = 'asof-offline sw-saved-note';
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'margin:.6rem 0;padding:.5rem .75rem;border:1px solid var(--border);border-left:3px solid var(--text-muted);border-radius:var(--r-sm,6px);background:var(--surface);color:var(--text);font-size:.88rem;line-height:1.4';
      var host = document.querySelector('main') || document.body;
      if (!host) return;
      host.insertBefore(bar, host.firstChild);
    }
    bar.textContent = (weak && n.onLine ? 'Weak signal.' : 'Offline.') + ' Showing saved ' + bits.slice(0, 2).join(' and ') + '.';
  }
  try {
    n.serviceWorker.addEventListener('message', function (e) {
      var m = e.data || {};
      if (m.type !== 'agsist-saved-data' || !NAMES[m.feed]) return;
      seen[m.feed] = when(m.dataTime || m.saved);
      var weak = m.reason === 'timeout';
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { paint(weak); });
      else paint(weak);
    });
  } catch (e) {}
})();
