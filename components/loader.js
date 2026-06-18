// AGSIST Component Loader — injects header (+ drawer), footer, analytics; initialises nav after inject
(function () {
  'use strict';

  // Apply saved theme immediately (before paint)
  try {
    var t = localStorage.getItem('agsist-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}

  var BASE = (function () {
    var m = document.querySelector('meta[name="agsist-base"]');
    return m ? m.getAttribute('content').replace(/\/$/, '') : '';
  })();

  // Component cache version. Bump on every chrome deploy so browsers fetch the
  // new header/footer; between deploys the files cache normally (no refetch /
  // no nav-flash on each page navigation).
  var CV = '14';
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
      .catch(function () { if (onDone) onDone(); });
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

    // ── Theme toggle ─────────────────────────────────────────────
    function applyTheme(th) {
      document.documentElement.setAttribute('data-theme', th);
      try { localStorage.setItem('agsist-theme', th); } catch (e) {}
      // Icon (moon/sun) is now a CSS-toggled SVG pair keyed off [data-theme];
      // no textContent here so the inline <svg>s aren't clobbered on toggle.
      var lbl  = th === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
      ['theme-btn', 'theme-btn-d'].forEach(function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.setAttribute('aria-label', lbl);
      });
    }
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

    ['theme-btn', 'theme-btn-d'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
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
  var COUNTER_URL = 'https://agsist-counter.dnilgis.workers.dev/'; // <-- set to your deployed worker URL ('' disables)
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
        var ctaUrl = (d && d.cta_url) || '/sponsor#supporter';
        var list = ((d && d.supporters) || []).filter(function (s) { return s && s.active === true; });
        if (!list.length) return;
        var open = row.querySelectorAll('.ad-slot--open');
        var fill = Math.min(list.length, open.length);
        for (var i = 0; i < fill; i++) {
          (function (s, slot) {
            var url = s.url || ctaUrl;
            if (!/^(https?:\/\/|\/)/.test(url)) url = ctaUrl;
            var ext = url.indexOf('http') === 0;
            var inner = s.logo
              ? '<img class="ad-filled-logo" src="' + esc(s.logo) + '" alt="' + esc(s.name) + '">'
              : '<span class="ad-filled-name">' + esc(s.name) + '</span>';
            var a = document.createElement('a');
            a.className = 'ad-slot ad-slot--filled';
            a.href = url;
            if (ext) { a.target = '_blank'; a.rel = 'sponsored noopener'; }
            else { a.rel = 'sponsored'; }
            a.innerHTML = '<span class="ad-slot-tag ad-slot-tag--live">Sponsor</span>'
              + inner
              + (s.blurb ? '<span class="ad-filled-blurb">' + esc(s.blurb) + '</span>' : '');
            a.addEventListener('click', function () {
              if (typeof gtag === 'function') gtag('event', 'supporter_click', { supporter: s.name || '' });
            });
            slot.parentNode.replaceChild(a, slot);
          })(list[i], open[i]);
        }
      })
      .catch(function () { /* leave mockups on any failure */ });
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectAnalytics();
    loadComponent('site-header', '/components/header.html', initNav);
    loadComponent('site-footer', '/components/footer.html', renderSupporters);
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
      '.agt-dot-stale{background:var(--gold,#daa520)}' +
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
