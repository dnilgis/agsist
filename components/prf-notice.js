/* components/prf-notice.js: "Email me when grid N's index posts" on /prf and
   the PRF county pages (2026-10-17, Sig approved).

   One ask for the grid the reader is looking at. It posts topic prf:<grid>
   (subs worker v5.29) through components/signup-ask.js, with after = the
   newest final interval in data/prf/meta.json, so the first email is the next
   index RMA posts, not one already on the page. scripts/send_prf_notice.py
   mails it from prf.yml: the interval, the final index, the grid's normal
   rain, a link back, and the unsubscribe line. Nothing else.

   PRF RULE: plain index information. No lead capture beyond the address the
   reader types for this email, no agent, no sales words. The briefing box
   starts empty; the reader ticks it to get the Daily too (Sig, 2026-10-19).

   WIRING
     <div class="prf-notice" data-prf-notice data-grid="30452" hidden></div>
   On a county page data-grid is the grid the "This interval so far" card
   opens on; the ask follows that card's grid picker (#prf-now-grid). On /prf
   it follows the page's grid (the prf:grid event and the "Your grid"
   heading, which also changes when a grid still needs its county).
   Pure helpers on window.AgPrfNotice (test/prf-notice.test.mjs). No em dashes. */
(function (root) {
  'use strict';

  /* The newest interval RMA has published, "YYYY-II", from meta.json. */
  function newestFinal(meta) {
    var y = meta && meta.years;
    if (!y) return '';
    var best = '';
    var open = y.open || {};
    Object.keys(open).forEach(function (yr) {
      var c = open[yr] || [];
      for (var i = c.length - 1; i >= 0; i--) {
        if (c[i] > 0) { var k = yr + '-' + (i < 9 ? '0' : '') + (i + 1); if (k > best) best = k; break; }
      }
    });
    if (!best && y.last_complete) best = y.last_complete + '-11';
    return /^\d{4}-(0[1-9]|1[01])$/.test(best) ? best : '';
  }
  function gridOk(g) {
    g = String(g || '');
    if (!/^[1-9]\d{3,4}$/.test(g)) return false;
    var n = +g, row = Math.floor((n - 1) / 300), col = (n - 1) % 300;
    return n >= 6196 && n <= 34941 && row >= 20 && row <= 116 && col >= 21 && col <= 251;
  }
  function source() {
    if (typeof location === 'undefined') return 'page:prf';
    return 'page:' + (location.pathname.replace(/\.html$/, '').replace(/^\/+|\/+$/g, '') || 'prf');
  }
  function askHtml(grid, after) {
    return '<div data-signup-ask="Email me when grid ' + grid + '’s index posts"'
      + ' data-topic="prf:' + grid + '"' + (after ? ' data-after="' + after + '"' : '')
      + ' data-source="' + source() + '"'
      + ' data-ok="Done. One email each time USDA RMA posts a final index for grid ' + grid + ', about once a month."'
      + ' data-note="The final index and the grid’s normal rain, nothing else. Your address goes to no agent."></div>';
  }

  var meta = null, metaP = null;
  function loadMeta() {
    if (!metaP) metaP = fetch('/data/prf/meta.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; }).then(function (m) { meta = m; return m; });
    return metaP;
  }

  function start() {
    var el = document.querySelector('[data-prf-notice]');
    if (!el) return;
    if (!document.getElementById('prf-notice-css')) {
      var st = document.createElement('style'); st.id = 'prf-notice-css';
      st.textContent = '.prf-notice{margin:1rem 0 .25rem}.prf-notice[hidden]{display:none}.prf-notice-done{margin:0;font-size:.9rem;color:var(--text-muted,#666)}'
        /* the /prf grid card is a narrow column on a wide screen: keep the label on its own line */
        + '.prf-notice .sa-f{grid-template-columns:minmax(0,1fr) auto}.prf-notice .sa-l{grid-column:1/-1}.prf-notice .sa-in{grid-column:1}.prf-notice .sa-b{grid-column:2}';
      document.head.appendChild(st);
    }
    var shown = '';
    function show(grid) {
      grid = String(grid || '');
      if (!gridOk(grid)) { el.hidden = true; shown = ''; return; }
      if (grid === shown) return;
      shown = grid;
      loadMeta().then(function () {
        if (shown !== grid) return;
        el.innerHTML = askHtml(grid, newestFinal(meta));
        var ask = el.firstChild;
        el.hidden = false;
        if (root.AgsistSignup && root.AgsistSignup.mount) root.AgsistSignup.mount(ask);
        /* already asked for in this browser: signup-ask hides it; say so in one line */
        if (ask.hidden) { el.innerHTML = '<p class="prf-notice-done">You asked for grid ' + grid + '’s index emails in this browser.</p>'; }
      });
    }
    /* signup-ask.js may load after this; mount when it arrives */
    if (!root.AgsistSignup) {
      var tries = 0, t = setInterval(function () {
        if (root.AgsistSignup || ++tries > 40) {
          clearInterval(t);
          var a = el.querySelector('[data-signup-ask]');
          if (root.AgsistSignup && a && !a.getAttribute('data-sa-ready')) {
            root.AgsistSignup.mount(a);
            if (a.hidden) el.innerHTML = '<p class="prf-notice-done">You asked for grid ' + shown + '’s index emails in this browser.</p>';
          }
        }
      }, 250);
    }
    document.addEventListener('prf:grid', function (ev) { if (ev.detail && ev.detail.grid) show(ev.detail.grid); });
    document.addEventListener('change', function (ev) { if (ev.target && ev.target.id === 'prf-now-grid') show(ev.target.value); });
    var h = document.getElementById('prf-where-h');
    if (h && root.MutationObserver) {
      new MutationObserver(function () { var m = /Grid (\d+)/.exec(h.textContent || ''); show(m ? m[1] : ''); })
        .observe(h, { childList: true, characterData: true, subtree: true });
    }
    var S = root.AgPrf && root.AgPrf.state;
    show(el.getAttribute('data-grid') || (S && S.grid) || '');
  }

  root.AgPrfNotice = { newestFinal: newestFinal, gridOk: gridOk, askHtml: askHtml };
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
