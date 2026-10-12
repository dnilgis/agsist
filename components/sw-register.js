/* AGSIST service worker registration, for pages that do not load
   components/loader.js (the generated ARC/PLC and basis pages). loader.js runs
   the same block; the window flag makes a page that loads both register once.
   Registers after the page's load event so it never competes with first paint.
   sw.js keeps HTML network first and data live (see the strategy at its top). */
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
})();
