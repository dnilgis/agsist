(function () {
  if (typeof window === 'undefined') return;
  var MIN_RATIO = 0.5;
  var MIN_MS = 1000;
  function ga(name, params) {
    try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) {}
  }
  function page() {
    try { return location.pathname.replace(/\/index\.html$/, '/') || '/'; } catch (e) { return '/'; }
  }
  function watch(el) {
    var slot = el.getAttribute('data-sponsor-slot') || 'unknown';
    if (el.__spWatched) return;
    el.__spWatched = true;
    if (!('IntersectionObserver' in window)) return;
    var timer = null, fired = false, since = 0, inView = false;
    function arm() {
      if (fired || timer || document.hidden) return;
      since = Date.now();
      timer = setTimeout(function () {
        fired = true;
        ga('sponsor_viewable', { slot: slot, page: page(), dwell_ms: Date.now() - since });
        io.disconnect();
      }, MIN_MS);
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (fired) return;
        inView = e.intersectionRatio >= MIN_RATIO;
        if (inView) {
          arm();
        } else {
          if (timer) { clearTimeout(timer); timer = null; }
        }
      });
    }, { threshold: [0, MIN_RATIO, 1] });
    io.observe(el);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && timer) { clearTimeout(timer); timer = null; }
      else if (!document.hidden && inView) arm();
    });
  }
  function wire() {
    var slots = document.querySelectorAll('[data-sponsor-slot]');
    for (var i = 0; i < slots.length; i++) watch(slots[i]);
    var links = document.querySelectorAll('[data-sponsor-click]');
    for (var j = 0; j < links.length; j++) {
      (function (a) {
        if (a.__spClick) return;
        a.__spClick = true;
        a.addEventListener('click', function () {
          ga('sponsor_click', { slot: a.getAttribute('data-sponsor-click') || 'unknown', page: page() });
        });
      })(links[j]);
    }
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', wire);
  else wire();
  try {
    new MutationObserver(wire).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
