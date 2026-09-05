/* SPONSOR METRICS — one definition of an impression, applied everywhere.
 *
 * WHAT COUNTS AS SEEN, AND WHY IT MATTERS THAT WE SAY SO
 *
 * The MRC/IAB standard for a viewable display impression is 50% of the ad's
 * pixels in the viewport for at least ONE CONTINUOUS SECOND. The observers on
 * this site fired at `threshold: .5` with no dwell — so an ad that flicked
 * past as somebody scrolled counted the same as one a farmer stopped and read.
 * Close to the standard, and not it.
 *
 * That gap matters because the whole product being sold to a sponsor here is
 * that the number is checkable. A media buyer who asks "is that viewable or
 * served?" and gets a straight answer is a buyer who renews.
 *
 * So: `sponsor_viewable` fires on the real rule, and carries the dwell it
 * measured. The older `sponsor_impression` events are left alone — they are
 * history under a looser definition, and the report page says so rather than
 * quietly mixing the two.
 *
 * NO COOKIES, NO IDENTIFIERS, NOTHING STORED. This counts events. It does not
 * know who you are and does not try to.
 *
 * MARK-UP:  <div data-sponsor-slot="cash-bids">…</div>
 *           <a data-sponsor-click="cash-bids" href="/sponsor">…</a>
 */
(function () {
  if (typeof window === 'undefined') return;
  var MIN_RATIO = 0.5;        /* MRC: half the pixels …            */
  var MIN_MS = 1000;          /* … for one continuous second        */

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
    var timer = null, fired = false, since = 0;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (fired) return;
        if (e.intersectionRatio >= MIN_RATIO) {
          if (timer) return;
          since = Date.now();
          timer = setTimeout(function () {
            fired = true;
            ga('sponsor_viewable', { slot: slot, page: page(), dwell_ms: Date.now() - since });
            io.disconnect();
          }, MIN_MS);
        } else {
          /* CONTINUOUS. Scrolling the ad half out of view before the second is
             up resets the clock — that is what "continuous" means, and it is
             the difference between this and a threshold that fires on a
             flick past. */
          if (timer) { clearTimeout(timer); timer = null; }
        }
      });
    }, { threshold: [0, MIN_RATIO, 1] });
    io.observe(el);

    /* A tab in the background is not viewable, whatever the geometry says. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && timer) { clearTimeout(timer); timer = null; }
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
  /* The header and footer are injected after load, and they carry slots. */
  try {
    new MutationObserver(wire).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
