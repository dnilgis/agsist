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

  var BASE = (function () {
    var m = document.querySelector('meta[name="agsist-base"]');
    return m ? m.getAttribute('content').replace(/\/$/, '') : '';
  })();

  // Component cache version. Bump on every chrome deploy so browsers fetch the
  // new header/footer; between deploys the files cache normally (no refetch /
  // no nav-flash on each page navigation).
  var CV = '31'; // v31 2026-10-09: signup wording, card tokens; v30 2026-10-09: one look, variable fonts; v29 2026-10-09: no-jump layout and loading states kit; v28 2026-10-09: menu shows Farmland Atlas once, footer keeps Cash Rent by State; v27 2026-10-09: instant pages, prerender-safe analytics, Updated stamps; v26 2026-10-09: header search button; v25 2026-10-09: em-dash cleanup and link fixes; v24 2026-10-08: footer sponsor pill no longer overlaps on phones; v23 2026-10-08: footer link columns fold into <details> on phones (closed at 700px and under)
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
        }
      });
    });

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
    }

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
    }

    function closeDr() {
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
    }

    window.closeDr = closeDr;

    var sb = document.getElementById('srch-btn');
    if (sb) sb.addEventListener('click', openSearch);
    if (ham) ham.addEventListener('click', openDr);
    if (dc)  dc.addEventListener('click', closeDr);
    if (ov)  ov.addEventListener('click', closeDr);

    // ── Active nav link highlight ─────────────────────────────────
    var path = window.location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('[data-nav-link], .nav-panel a, .drawer-link, .draw-item').forEach(function (a) {
      var href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/';
      var active = (href === path) || (href !== '/' && path.startsWith(href));
      if (active) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    });

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
    // 2) fill open ad slots with active sponsors (mockups stay where none)
    var row = document.getElementById('adspace-row');
    if (!row) return;
    fetch(BASE + '/data/supporters.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var ctaUrl = (d && d.cta_url) || '/sponsor#slots';
        var list = ((d && d.supporters) || []).filter(function (s) { return s && s.active === true; });
        if (!list.length) return;
        var open = row.querySelectorAll('.ad-slot--open');
        // Fill the open slot(s) first; if there are more paying supporters
        // than open slots (footer now carries a single teaser slot), append
        // extra filled cards so no paying sponsor is ever dropped.
        for (var i = 0; i < list.length; i++) {
          (function (s, slot) {
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
            // This card is only ever built for an ACTIVE supporter, so unlike
            // the open slot beside it, it is a real ad and counts as one. The
            // old inline supporter_click listener was DELETED in the same edit
            // that added these attributes -- leaving both would have counted
            // every click twice, and a doubled CTR is worse than no CTR.
            a.setAttribute('data-sponsor-slot', 'footer-strip');
            a.setAttribute('data-sponsor-click', 'footer-strip');
            if (slot) slot.parentNode.replaceChild(a, slot);
            else row.appendChild(a);
          })(list[i], open[i]);
        }
      })
      .catch(function () { /* leave mockups on any failure */ });
  }

  // ── Sold page slots (2026-10-07) ───────────────────────────────
  // Each tool page ships an OPEN ribbon ("Sponsor this page", price, button).
  // When a sponsor has bought that page, data/page-sponsors.json carries them
  // under the ribbon's slot id, written by scripts/sponsor_apply.py once Sig
  // approves. From the entry's start date (Central time) the open ribbon is
  // replaced by theirs. Any failure leaves the open ribbon, which is honest:
  // the slot is shown as for sale rather than as somebody's ad gone blank.
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
    var a = rib.querySelector('a[href*="slot="]');
    var m = a && /[?&]slot=([a-z0-9-]+)/.exec(a.getAttribute('href') || '');
    if (!m) return;
    var id = m[1];
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
      .catch(function () { /* the open ribbon stays */ });
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

  document.addEventListener('DOMContentLoaded', function () {
    injectAnalytics();
    loadComponent('site-header', '/components/header.html', initNav);
    loadComponent('site-footer', '/components/footer.html', function () { foldFooter(); renderSupporters(); });
    fillPageRibbons();
    loadSponsorMetrics();
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
  s.src = '/components/signup-ask.js?v=4';
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
