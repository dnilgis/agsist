/* components/cb-buyers.js -- the "Nearby buyers within 50 miles" list on a
 * cash-bids town page and an Atlas county home.
 *
 * The page (scripts/build_buyers.py line_html) carries only a closed
 * <details data-buyers="id:miles,..."> with the count line and the note. The
 * first time it is opened this fetches /data/buyers.json once and lists each
 * buyer: name, town, type, miles (worked out when the page was built, so the
 * list always matches the count) and capacity as its list publishes it.
 * Nothing is estimated here. If the file cannot be read the box says so and
 * the next open tries again.
 */
(function () {
  'use strict';
  var data = null, wait = null;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function get() {
    if (data) return Promise.resolve(data);
    if (!wait) {
      wait = fetch('/data/buyers.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { data = j; return j; })
        .catch(function (e) { wait = null; throw e; });
    }
    return wait;
  }
  function item(p, d, kinds) {
    var bits = [esc((kinds[p.k] || [p.k])[0]), d < 1 ? 'under 1 mi' : esc(d) + ' mi'];
    if (p.rr && p.rr.length) bits.push(esc(p.rr.join(' and ')));
    bits.push(p.cap ? esc(p.cap) + (p.eia && p.eia !== p.cap ? ' (EIA: ' + esc(p.eia) + ')' : '') : 'capacity not published');
    return '<li><b>' + esc(p.n) + '</b>, ' + esc(p.town) + ', ' + esc(p.st) + '<br><span class="cbt-mut">' +
      bits.join(' &middot; ') + '</span></li>';
  }
  function draw(el) {
    var box = el.querySelector('.buyers-list');
    if (!box || el.getAttribute('data-drawn')) return;
    get().then(function (j) {
      var P = j.plants || {}, kinds = j.kinds || {}, out = [];
      String(el.getAttribute('data-buyers') || '').split(',').forEach(function (x) {
        var a = x.split(':'), p = P[a[0]];
        if (p) out.push(item(p, +a[1], kinds));
      });
      box.innerHTML = out.length ? '<ul class="cbt-nl">' + out.join('') + '</ul>'
        : 'The buyer list changed since this page was built. Reload the page to see it.';
      el.setAttribute('data-drawn', '1');
    }).catch(function () {
      box.textContent = 'The buyer list could not be loaded right now. Close and open this again to retry.';
    });
  }
  function init() {
    var els = document.querySelectorAll('details[data-buyers]');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        el.addEventListener('toggle', function () { if (el.open) draw(el); });
        if (el.open) draw(el);
      })(els[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
