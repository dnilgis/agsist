/* AGSIST "Next" block. 2026-10-18.

   So no page is a dead end: one data map (data/next-links.json, keyed by
   path) lists 2 or 3 related pages for each page, and this file adds them as
   a short "Next" list at the end of the page's main content. When the page
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
  window.AgsistNext = { _v: 1 };

  function key() {
    var p = location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    if (p.length > 1) p = p.replace(/\/$/, '');
    return p || '/';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function hasSignup(main) {
    return !!main.querySelector('[data-signup-ask],.signup-form,.cb-signup,[data-signup],input[type="email"]');
  }

  var CSS = '.next-links{max-width:780px;margin:2rem auto 1rem;padding:1rem 1rem .4rem;border-top:1px solid var(--border-2,rgba(132,160,168,.24));box-sizing:border-box}' +
    '.next-links h2{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin:0 0 .5rem;font-family:var(--font-body,inherit)}' +
    '.next-links ul{list-style:none;margin:0;padding:0;display:grid;gap:.25rem}' +
    '.next-links li{margin:0}.next-links a{display:inline-block;padding:.45rem 0;min-height:24px;color:var(--gold,#d4a23f);font-weight:600;text-decoration:none}' +
    '.next-links a:hover{text-decoration:underline}.next-links span{display:block;color:var(--text-dim);font-size:.85rem;margin:-.2rem 0 .25rem}' +
    '.next-links .nx-ask{margin-top:.8rem}';

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
      h += '<li><a href="' + esc(l.href) + '">' + esc(l.text) + '</a>' + (l.why ? '<span>' + esc(l.why) + '</span>' : '') + '</li>';
    });
    h += '</ul>';
    var ask = e.signup !== false && !hasSignup(main);
    if (ask) h += '<div class="nx-ask" data-signup-ask="' + esc(e.ask || map.ask) + '" data-source="next:' + esc(k.replace(/^\//, '') || 'home') + '"></div>';
    nav.innerHTML = h;
    host.appendChild(nav);
    if (ask && window.AgsistSignup && window.AgsistSignup.scan) window.AgsistSignup.scan();
  }

  function start() {
    fetch('/data/next-links.json').then(function (r) { return r.ok ? r.json() : null; }).then(run).catch(function () {});
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
