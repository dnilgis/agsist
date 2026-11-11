/* page-tabs.js: tabs on a page that holds what used to be several pages (Nov 11, 2026: /rain holds the
 * radar lookup and the drought monitor, /spray holds urea loss and fall anhydrous).
 *
 * Markup (one block per page):
 *   <div class="ptabs" data-ptabs="radar county drought" data-default="radar">
 *     <div class="ptab-bar" role="tablist" aria-label="...">
 *       <a role="tab" id="radar" href="#p-radar" data-tab="radar" aria-controls="p-radar">...</a> ...
 *     </div>
 *     <script> the early pick (PICK below, copied inline): sets data-on before the panels paint </script>
 *     <section class="ptab" id="p-radar" role="tabpanel" aria-labelledby="radar"
 *              data-js="/a.js /b.js" data-css="/c.css /d.css"> ... </section> ...
 *   </div>
 *
 * The address names the tab: /rain#drought, /spray#urea. The old pages forward there
 * (scripts/moved_pages.py). Without JavaScript every panel shows, one after the other, and
 * the tab links jump to them. A panel's own code (data-js, in order) and style (data-css) load
 * the first time it opens, so a map in a closed tab costs nothing. A #hash that names
 * something inside a panel opens that panel first.
 */
(function () {
  'use strict';
  var loaded = {};

  function have(src) {
    if (loaded[src]) return true;
    var s = document.querySelectorAll('script[src]');
    for (var i = 0; i < s.length; i++) if (s[i].getAttribute('src') === src) return true;
    return false;
  }

  function script(src) {
    if (have(src)) return loaded[src] || Promise.resolve();
    loaded[src] = new Promise(function (ok, no) {
      var e = document.createElement('script');
      e.src = src;
      e.onload = ok;
      e.onerror = function () { loaded[src] = null; no(new Error(src)); };
      document.body.appendChild(e);
    });
    return loaded[src];
  }

  function style(href, done) {
    if (document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) { done(); return; }
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = done;
    l.onerror = done;
    document.head.appendChild(l);
  }

  function load(panel) {
    if (panel.getAttribute('data-loading')) return;
    panel.setAttribute('data-loading', '1');
    var css = (panel.getAttribute('data-css') || '').split(/\s+/).filter(Boolean), js = (panel.getAttribute('data-js') || '').split(/\s+/).filter(Boolean);
    var left = css.length, ready = function () { if (--left <= 0) panel.setAttribute('data-ready', '1'); };
    if (css.length) css.forEach(function (h) { style(h, ready); }); else ready();
    js.reduce(function (p, src) { return p.then(function () { return script(src); }); }, Promise.resolve())
      .then(function () { panel.dispatchEvent(new CustomEvent('ptab:loaded', { bubbles: true })); },
            function () {
              panel.removeAttribute('data-loading');
              var n = panel.querySelector('[data-ptab-note]');
              if (n) { n.textContent = 'This part did not load. Check your signal and open the tab again.'; n.hidden = false; }
            });
  }

  function setup(box) {
    var ids = (box.getAttribute('data-ptabs') || '').split(/\s+/).filter(Boolean);
    var tabs = [].slice.call(box.querySelectorAll('[role="tab"][data-tab]'));
    var panelOf = function (id) { return document.getElementById('p-' + id); };

    function show(id, opts) {
      opts = opts || {};
      if (ids.indexOf(id) < 0) return;
      box.setAttribute('data-on', id);
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-tab') === id;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.setAttribute('tabindex', on ? '0' : '-1');
      });
      var p = panelOf(id);
      if (p) {
        load(p);
        p.dispatchEvent(new CustomEvent('ptab:show', { bubbles: true, detail: { tab: id } }));
      }
      if (opts.hash) {
        try { history.replaceState(history.state, '', location.pathname + location.search + '#' + id); } catch (e) { location.hash = id; }
      }
      if (opts.focus) { var t = document.getElementById(id); if (t) t.focus(); }
      if (window.gaEvent && opts.hash) { try { window.gaEvent('page_tab', { tab: id, page: location.pathname }); } catch (e) {} }
    }

    // a #hash: a tab name, a panel id, or something inside a panel (an old section link)
    function fromHash(scroll) {
      var h = decodeURIComponent((location.hash || '').slice(1));
      if (!h) return false;
      var id = h.replace(/^p-/, '');
      if (ids.indexOf(id) >= 0) { show(id); if (scroll === 'nav') box.scrollIntoView(); return true; }
      var el = document.getElementById(h);
      if (!el || !box.contains(el)) return false;
      for (var i = 0; i < ids.length; i++) {
        var p = panelOf(ids[i]);
        if (p && p.contains(el)) {
          show(ids[i]);
          if (el.tagName === 'DETAILS') el.open = true;
          if (scroll) el.scrollIntoView();
          return true;
        }
      }
      return false;
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function (e) {
        e.preventDefault();
        show(t.getAttribute('data-tab'), { hash: true });
      });
      t.addEventListener('keydown', function (e) {
        var i = tabs.indexOf(t), n = tabs.length, j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % n;
        else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = n - 1;
        if (j < 0) return;
        e.preventDefault();
        show(tabs[j].getAttribute('data-tab'), { hash: true, focus: true });
      });
    });
    // links on the page to another tab (<a href="#urea">) switch tabs without a reload
    box.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || a.getAttribute('role') === 'tab') return;
      var id = a.getAttribute('href').slice(1);
      if (ids.indexOf(id) < 0) return;
      e.preventDefault();
      show(id, { hash: true });
      box.scrollIntoView();
    });
    window.addEventListener('hashchange', function () { fromHash('nav'); });

    if (!fromHash(true)) show(box.getAttribute('data-on') || box.getAttribute('data-default') || ids[0]);
  }

  function init() { [].forEach.call(document.querySelectorAll('.ptabs[data-ptabs]'), setup); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
