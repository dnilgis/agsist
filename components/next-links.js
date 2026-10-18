/* AGSIST "Next" block. 2026-10-18.

   So no page is a dead end: one data map (data/next-links.json, keyed by
   path) lists 2 or 3 related pages for each page, and this file adds them as
   a short "Next" list at the end of the page's main content. Each page reads
   only its own entry, data/next/<path>.json (scripts/build_next_links.py
   writes them from the map; "/" is data/next/index.json), not the whole map.

   Email ask (Oct 18): the site footer carries the AGSIST Daily signup band,
   so the Next block adds the ask ONLY when the page has no signup anywhere
   and no site footer coming (#site-footer). Two identical boxes in a row
   read as a mistake. An entry with "signup": false never gets it either.

   Glossary marks: glossary.js and data/glossary.json load only after the
   page is idle AND only when the main text has a candidate term (PRE, a
   cheap test over the text; test/r8fix.test.mjs checks every term in
   data/glossary.json is caught by it).

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

  var SIGNUP = '[data-signup-ask],.signup-form,.cb-signup,[data-signup],input[type="email"]';
  function wantAsk() {
    return !doc.querySelector(SIGNUP) && !doc.getElementById('site-footer');
  }

  var CSS = '.next-links{max-width:780px;margin:2rem auto 1rem;padding:1rem 1rem .4rem;border-top:1px solid var(--border-2,rgba(132,160,168,.24));box-sizing:border-box}' +
    '.next-links h2{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin:0 0 .5rem;font-family:var(--font-body,inherit)}' +
    '.next-links ul{list-style:none;margin:0;padding:0;display:grid;gap:.25rem}' +
    '.next-links li{margin:0}.next-links a{display:inline-block;padding:.45rem 0;min-height:24px;color:var(--gold,#d4a23f);font-weight:600;text-decoration:none}' +
    '.next-links a:hover{text-decoration:underline}.next-links span{display:block;color:var(--text-dim);font-size:.85rem;margin:-.2rem 0 .25rem}' +
    '.next-links .nx-ask{margin-top:.8rem}';

  function run(map) {
    var k = key(), e = map;
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
    var ask = e.signup !== false && wantAsk();
    if (ask) h += '<div class="nx-ask" data-signup-ask="' + esc(e.ask) + '" data-source="next:' + esc(k.replace(/^\//, '') || 'home') + '"></div>';
    nav.innerHTML = h;
    host.appendChild(nav);
    if (ask && window.AgsistSignup && window.AgsistSignup.scan) window.AgsistSignup.scan();
  }

  /* the glossary marks ride along, so a page needs only this one tag */
  var PRE = /\b(basis|cash bids?|futures|settle(?:ment)?|nearby|carry|carryout|cwt|managed money|ending stocks|the trade|trade (?:estimates?|guess)|WASDE|NASS|RMA|FSA|CRP|CCA|NOAA|crop progress|black layer|shrink|nowcasts?|net 30|CBOT|CFTC|open interest|marketing year|APH)\b/i;
  function glossary() {
    if (window.AgsistGlossary || doc.querySelector('script[src*="/components/glossary.js"]')) return;
    var top = doc.querySelector('[data-glossary-root]') || doc.querySelector('main');
    var off = function (el) { return el && el.getAttribute('data-glossary') === 'off'; };
    if (!top || off(doc.documentElement) || off(doc.body) || !PRE.test(top.textContent || '')) return;
    var g = doc.createElement('script'); g.src = '/components/glossary.js?v=2'; g.defer = true; doc.body.appendChild(g);
  }
  function idle(fn) {
    var go = function () { if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 1200); };
    if (doc.readyState === 'complete') go(); else window.addEventListener('load', go);
  }
  function dataUrl() {
    var k = key();
    return '/data/next' + (k === '/' ? '/index' : k) + '.json';
  }

  function start() {
    idle(glossary);
    fetch(dataUrl()).then(function (r) { return r.ok ? r.json() : null; }).then(function (e) { if (e) run(e); }).catch(function () {});
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
