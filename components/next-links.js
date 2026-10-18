/* AGSIST "Next" block. 2026-10-18.

   So no page is a dead end: one data map (data/next-links.json, keyed by
   path) lists 2 or 3 related pages for each page, and this file adds them as
   a short "Next" row of cards at the end of the page's main content. When the page
   has no email signup of its own, it also adds the AGSIST Daily ask
   (components/signup-ask.js renders it); an entry with "signup": false
   skips that.

   Where it goes: [data-next-root] if the page has one, else the last
   <article> inside <main>, else <main>. A page without an entry gets nothing.
   test/fresh-visitor.test.mjs checks every link in the map is a real page. */
(function () {
  'use strict';
  var doc = document;
  if (window.AgsistNext) return;
  window.AgsistNext = { _v: 2 };

  function key() {
    var p = location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    if (p.length > 1) p = p.replace(/\/$/, '');
    return p || '/';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function hasSignup(main) {
    return !!main.querySelector('[data-signup-ask],.signup-form,.cb-signup,[data-signup],input[type="email"]');
  }

  /* 2026-10-18 v2 (Sig: "lots of alignment issues"): a row of 2 or 3 cards,
     stacked on phones, lined up with the page's own content column (align()
     measures the block just above and matches its edges). */
  var CSS = '.next-links{display:block;max-width:1100px;margin:2.5rem auto 1rem;padding:0;box-sizing:border-box}' +
    '.next-links h2{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin:0 0 .75rem;font-family:var(--font-body,inherit);font-weight:700}' +
    '.next-links ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:.75rem}' +
    '.next-links li{margin:0;display:flex;min-width:0}' +
    '.next-links a.nx-c{flex:1;display:flex;flex-direction:column;gap:.25rem;min-height:44px;padding:.875rem 1rem;box-sizing:border-box;border:1px solid var(--border-2,rgba(132,160,168,.24));border-radius:8px;background:var(--surface,transparent);color:var(--text);text-decoration:none;transition:border-color .15s}' +
    '.next-links a.nx-c:hover{border-color:var(--gold,#d4a23f)}' +
    '.next-links a.nx-c:focus-visible{outline:2px solid var(--gold,#d4a23f);outline-offset:2px}' +
    '.next-links .nx-t{color:var(--gold,#d4a23f);font-weight:600;line-height:1.35}' +
    '.next-links .nx-t::after{content:" \\2192";font-weight:400}' +
    '.next-links .nx-w{color:var(--text-dim);font-size:.85rem;line-height:1.45}' +
    '.next-links .nx-ask{margin-top:1rem}' +
    '@media (prefers-reduced-motion:reduce){.next-links a.nx-c{transition:none}}';

  /* Match the edges of the nearest real block above the Next block (not a
     script, a hidden ribbon or a full-bleed band). None found: the CSS
     default (centered, 1100px at most) stands. */
  function align(nav) {
    nav.style.marginLeft = nav.style.width = nav.style.maxWidth = '';
    var vw = doc.documentElement.clientWidth, s = nav.previousElementSibling, t = null;
    for (var k = 0; s && k < 8; s = s.previousElementSibling, k++) {
      if (/^(SCRIPT|STYLE|ASIDE|TEMPLATE|LINK)$/.test(s.tagName)) continue;
      var r = s.getBoundingClientRect();
      if (!r.height || r.width < 280 || r.width >= vw - 1) continue;
      t = r; break;
    }
    if (!t) return;
    var host = nav.parentElement, hr = host.getBoundingClientRect(), cs = getComputedStyle(host);
    var left = hr.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    var inner = host.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var off = Math.max(0, Math.round(t.left - left)), w = Math.min(Math.round(t.width), inner - off);
    if (w < 240) return;
    nav.style.maxWidth = 'none'; nav.style.marginLeft = off + 'px'; nav.style.width = w + 'px';
  }

  function run(map) {
    var k = key(), e = map && map.pages && map.pages[k];
    if (!e || !e.links || !e.links.length) return;
    var main = doc.querySelector('main');
    if (!main || doc.querySelector('.next-links')) return;
    var host = doc.querySelector('[data-next-root]');
    if (!host) { var arts = main.querySelectorAll('article'); host = arts.length ? arts[arts.length - 1] : main; }
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    var nav = doc.createElement('nav');
    nav.className = 'next-links'; nav.setAttribute('aria-labelledby', 'nx-h');
    var h = '<h2 id="nx-h">Next</h2><ul>';
    e.links.forEach(function (l) {
      h += '<li><a class="nx-c" href="' + esc(l.href) + '"><span class="nx-t">' + esc(l.text) + '</span>' + (l.why ? '<span class="nx-w">' + esc(l.why) + '</span>' : '') + '</a></li>';
    });
    h += '</ul>';
    var ask = e.signup !== false && !hasSignup(main);
    if (ask) h += '<div class="nx-ask" data-signup-ask="' + esc(e.ask || map.ask) + '" data-source="next:' + esc(k.replace(/^\//, '') || 'home') + '"></div>';
    nav.innerHTML = h;
    host.appendChild(nav);
    align(nav);
    var raf = 0, re = function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { align(nav); }); };
    window.addEventListener('resize', re);
    window.addEventListener('load', re);
    if (ask && window.AgsistSignup && window.AgsistSignup.scan) window.AgsistSignup.scan();
  }

  /* the glossary marks ride along, so a page needs only this one tag */
  function glossary() {
    if (window.AgsistGlossary || doc.querySelector('script[src*="/components/glossary.js"]')) return;
    var g = doc.createElement('script'); g.src = '/components/glossary.js?v=1'; g.defer = true; doc.body.appendChild(g);
  }

  function start() {
    glossary();
    fetch('/data/next-links.json').then(function (r) { return r.ok ? r.json() : null; }).then(run).catch(function () {});
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
