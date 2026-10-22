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
 *   AgRpShort.mint(code) -> the same Promise, asked at once with no wait: for
 *     a press (an order file, checkout, the order form), never a redraw
 *     (2026-10-14: the page no longer asks on a redraw; previews carry the
 *     standard code). One request per code: a cached id or one in flight is
 *     reused.
 *   AgRpShort.mint(code, {fresh: true}) -> the same, but always asks the
 *     worker (a kept id is not trusted alone): the checkout press.
 *     {timeout: ms} gives up sooner than TIMEOUT_MS (checkout: 4 s, 2026-10-22).
 *   AgRpShort.peek(code) -> the cached link right now, or null. No request.
 *   AgRpShort.resolve(id) -> Promise of {code, missing}: the design code an
 *     id stands for (GET /rp-short/<id>, as /r does), for ?d=RPS-<id>.
 *
 * Kept in memory and in localStorage (an id never changes for a code). Every
 * storage access is in try/catch: a private window or blocked storage only
 * means the link is asked for again. Uppercase on purpose: QR byte mode
 * stores it the same size, and phones open it as https://agsist.com/R?ID. */
(function (root) {
  'use strict';
  if (root.AgRpShort) return;

  var WORKER = 'https://agsist-api.dnilgis.workers.dev/rp-short';
  var BASE = 'HTTPS://AGSIST.COM/R?';
  var KEY = 'agsist-rps:';
  // 3 s (was 1.2, 2026-10-14 panel 3 F3): a pause while typing a name no longer makes a short id of its own
  var WAIT_MS = 3000, TIMEOUT_MS = 6000;
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

  function ask(code, ms) {
    if (inflight[code]) return inflight[code];
    var p = new Promise(function (resolve) {
      var done = false, t = null;
      function end(v) { if (!done) { done = true; if (t) clearTimeout(t); delete inflight[code]; resolve(v); } }
      try {
        if (typeof root.fetch !== 'function') return end(null);
        t = setTimeout(function () { end(null); }, ms || TIMEOUT_MS);
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

  function mint(code, opts) {
    try {
      code = String(code || '');
      if (!CODE_RE.test(code) || code.indexOf('GIFT-') === 0) return Promise.resolve(null);
      // opts.fresh: ask the worker even with an id kept here, so the id Stripe gets is one the worker has (checkout, 2026-10-15)
      var hit = opts && opts.fresh ? null : peek(code);
      if (hit) return Promise.resolve(hit);
      var ms = opts && opts.timeout;
      if (waiting && waiting.code === code) { clearTimeout(waiting.timer); var w = waiting; waiting = null; ask(code, ms).then(w.resolve); return w.promise; }
      return ask(code, ms);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  /* The other way: an id to its design code, as /r does (GET /rp-short/<id>),
     for a Stripe reference RPS-<id> opened as rain-print?d=RPS-<id>.
     Promise of {code} (a design code, or null) plus missing: true when the
     worker says it has no such id. Never rejects. */
  function resolve(id) {
    return new Promise(function (done) {
      var over = false, t = null;
      function end(v) { if (!over) { over = true; if (t) clearTimeout(t); done(v); } }
      try {
        id = String(id || '');
        if (!ID_RE.test(id) || typeof root.fetch !== 'function') return end({ code: null });
        t = setTimeout(function () { end({ code: null }); }, 8000);
        root.fetch(WORKER + '/' + id)
          .then(function (r) { return r.status === 404 ? { missing: true } : r.ok ? r.json() : null; })
          .then(function (j) {
            var code = j && typeof j.code === 'string' ? j.code : '';
            if (!CODE_RE.test(code)) return end({ code: null, missing: !!(j && j.missing) });
            keep(code, id);
            end({ code: code });
          })
          .catch(function () { end({ code: null }); });
      } catch (e) { end({ code: null }); }
    });
  }

  root.AgRpShort = { getShortLink: getShortLink, mint: mint, peek: peek, resolve: resolve, BASE: BASE, WAIT_MS: WAIT_MS };
})(typeof window !== 'undefined' ? window : this);
