/* agsist GA gate (2026-10-20, Sig: keep readers anywhere in GA, keep data
 * centers out). The inline agsist-ga-guard in every page's head loads this
 * file on the reader's first scroll, tap or key press, and only when its own
 * rules (Global Privacy Control, the /privacy switch, automated browsers,
 * prerender) already allow analytics.
 *
 * This file asks the agsist-subs worker, GET /ga-ok, whether the visit comes
 * from a cloud or hosting network (Cloudflare's ASN for the request; the
 * worker keeps no address). Only {"ok":true} loads gtag.js. A false answer,
 * an error, a non-JSON answer or no answer within 3 seconds keeps GA off.
 * A clear answer is kept for this tab in sessionStorage (agsist-ga-ok, 1 or
 * 0), so the worker is asked once per visit, not once per page. A failure is
 * not kept, so the next page asks again.
 */
(function (w, d) {
  var K = 'agsist-ga-ok', API = 'https://agsist-subs.dnilgis.workers.dev/ga-ok';
  var SRC = 'https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';
  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    var s = d.createElement('script');
    s.async = true;
    s.src = SRC;
    (d.head || d.documentElement).appendChild(s);
  }
  function keep(v) { try { w.sessionStorage.setItem(K, v); } catch (e) {} }
  if (w.agsistGaOff === true || w.agsistGaGate) return;
  w.agsistGaGate = 1;
  /* the /privacy switch may have been set on this page after the guard ran */
  try { if (w.localStorage.getItem('agsist-ga-off') === '1') return; } catch (e) {}
  var c = null;
  try { c = w.sessionStorage.getItem(K); } catch (e) {}
  if (c === '1') { load(); return; }
  if (c === '0') return;
  if (typeof w.fetch !== 'function') return;
  var ac = typeof w.AbortController === 'function' ? new w.AbortController() : null;
  var live = true;
  var timer = w.setTimeout(function () { live = false; if (ac) ac.abort(); }, 3000);
  w.fetch(API, { credentials: 'omit', cache: 'default', signal: ac ? ac.signal : undefined })
    .then(function (r) { return r && r.ok ? r.json() : null; })
    .then(function (j) {
      if (!live) return;
      w.clearTimeout(timer);
      if (!j || typeof j.ok !== 'boolean') return;
      keep(j.ok ? '1' : '0');
      if (j.ok === true) load();
    })
    .catch(function () { w.clearTimeout(timer); });
})(window, document);
