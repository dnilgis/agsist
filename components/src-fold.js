/* Open the Sources fold when a link or the address points at something inside it. */
(function () {
  function openFor(id) {
    if (!id) return;
    var el;
    try { el = document.getElementById(decodeURIComponent(id)); } catch (e) { return; }
    for (var d = el && el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
      if (!d.open) d.open = true;
      if (el) el.scrollIntoView();
    }
  }
  function go() { openFor(location.hash.slice(1)); }
  window.addEventListener('hashchange', go);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
