/* components/rp-short.js: short links for the Rain Print QR (2026-10-12).
 *
 * The print's QR used to carry agsist.com/rain-print?d=<design code>, which
 * comes out at QR version 6 to 10. HTTPS://AGSIST.COM/R?<id> with a 5-letter
 * id is 26 bytes: version 2, 25 x 25 modules at level M (components/qr.js).
 * The subs worker (v5.14, POST /rp-short) gives the id; /R looks it up.
 *
 *   AgRpShort.getShortLink(code) -> Promise of 'HTTPS://AGSIST.COM/R?ID', or
 *     null on any failure, so the caller keeps the long link. A call with a
 *     new code waits WAIT_MS before posting; a newer call in that time takes
 *     its place and the older one resolves null (the design changed anyway),
 *     so typing a name makes one request, not one per letter.
 *   AgRpShort.peek(code) -> the cached link right now, or null. No request.
 *
 * Kept in memory and in localStorage (an id never changes for a code). Every
 * storage access is in try/catch: a private window or blocked storage only
 * means the link is asked for again. Uppercase on purpose: QR byte mode
 * stores it the same size, and phones open it as https://agsist.com/R?ID. */
(function (root) {
  'use strict';
  if (root.AgRpShort) return;

  var WORKER = 'https://agsist-subs.dnilgis.workers.dev/rp-short';
  var BASE = 'HTTPS://AGSIST.COM/R?';
  var KEY = 'agsist-rps:';
  var WAIT_MS = 1200, TIMEOUT_MS = 6000;
  var ID_RE = /^[0-9A-HJKMNP-TV-Z]{5,8}$/;
  var CODE_RE = /^[A-Za-z0-9_-]{8,400}$/;
  var mem = {}, inflight = {}, waiting = null;

  function stored(code) {
    var id = null;
    try { id = root.localStorage ? root.localStorage.getItem(KEY + code) : null; } catch (e) { id = null; }
    return id && ID_RE.test(id) ? id : null;
  }
  function keep(code, id) {
    mem[code] = id;
    try { if (root.localStorage) root.localStorage.setItem(KEY + code, id); } catch (e) { /* not kept; asked again next visit */ }
  }
  function peek(code) {
    code = String(code || '');
    if (!CODE_RE.test(code)) return null;
    var id = mem[code] || stored(code);
    if (id) { mem[code] = id; return BASE + id; }
    return null;
  }

  function ask(code) {
    if (inflight[code]) return inflight[code];
    var p = new Promise(function (resolve) {
      var done = false, t = null;
      function end(v) { if (!done) { done = true; if (t) clearTimeout(t); delete inflight[code]; resolve(v); } }
      try {
        if (typeof root.fetch !== 'function') return end(null);
        t = setTimeout(function () { end(null); }, TIMEOUT_MS);
        root.fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            var id = j && typeof j.id === 'string' ? j.id : '';
            if (!ID_RE.test(id)) return end(null);
            keep(code, id);
            end(BASE + id);
          })
          .catch(function () { end(null); });
      } catch (e) { end(null); }
    });
    inflight[code] = p;
    return p;
  }

  function getShortLink(code) {
    try {
      code = String(code || '');
      if (!CODE_RE.test(code) || code.indexOf('GIFT-') === 0) return Promise.resolve(null);
      var hit = peek(code);
      if (hit) return Promise.resolve(hit);
      if (inflight[code]) return inflight[code];
      if (waiting && waiting.code === code) return waiting.promise;
      if (waiting) { clearTimeout(waiting.timer); waiting.resolve(null); }
      var w = { code: code };
      w.promise = new Promise(function (resolve) {
        w.resolve = resolve;
        w.timer = setTimeout(function () {
          if (waiting === w) waiting = null;
          ask(code).then(resolve);
        }, WAIT_MS);
      });
      waiting = w;
      return w.promise;
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  root.AgRpShort = { getShortLink: getShortLink, peek: peek, BASE: BASE };
})(typeof window !== 'undefined' ? window : this);
