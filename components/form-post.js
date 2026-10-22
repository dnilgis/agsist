/* The site's forms (elevator claim, sponsor proof approval and requests,
 * Parcel Report waitlist, 2026-10-11; Rain Print order requests, kind
 * rain-print-order, worker v5.9, same day).
 *
 * They post to AGSIST's own subs worker (POST /form, workers/subs-worker.js
 * v5.8), which stores them; scripts/form_digest.py mails Sig. Until Sig
 * deploys that worker version the route does not exist, so whenever the
 * worker answers 403, 404, 405 or 5xx, does not answer, or the browser cannot
 * read the answer, or the worker does not know the form's kind yet (400
 * "unknown form"), the same post goes to the Formspree form these pages used
 * before. A refusal the worker means (400 bad field, 429 too many) is passed
 * back to the page, which shows its own "did not go through" message.
 *
 *   agsistFormPost(kind, data, formspreeFields) -> Promise
 *     resolves {ok:true, via:'worker'|'formspree'}, rejects when neither took it.
 *     formspreeFields is what goes to Formspree (defaults to data).
 *   agsistFormPost(kind, data, formspreeFields, {workerMs}) waits workerMs for
 *     the worker instead of 12 s (a checkout waiting on it, 2026-10-22).
 *   agsistFormPost.formspree(fields) -> Promise: Formspree alone.
 *   agsistFormPost.worker(kind, data) -> Promise
 *     resolves {ok:true, via:'worker'} or the string 'fallback'; rejects on a
 *     refusal. For a plain HTML form that falls back by submitting itself.
 *     A worker that has not answered in 12 seconds counts as 'fallback'.
 *
 * WORKER_ONLY (2026-10-19, Sig): a kind that carries a business's customer
 * list never goes to Formspree. The business page promises "your list stays
 * with me", so when the worker fails or is silent the post rejects instead
 * (an Error with .workerOnly true, and .slow true when the worker only went
 * quiet and may still have it). The page keeps the list and says to call or
 * try again. Every other kind keeps the Formspree fallback.
 *
 * THE OUTBOX (2026-10-22): with components/outbox.js on the page, a
 * WORKER_ONLY post the worker did not take is kept in this browser and
 * resolves {ok:true, via:'outbox', queued:true}; the page says so plainly,
 * and the post goes to the worker on the next visit after it is back. Still
 * never to Formspree. Without outbox.js (or with storage blocked) it rejects
 * as before.
 */
(function () {
  'use strict';
  var WORKER = 'https://agsist-api.dnilgis.workers.dev/form';
  var FORMSPREE = 'https://formspree.io/f/xnjbwepn';
  var FALLBACK = { 403: 1, 404: 1, 405: 1 };
  // kinds with a customer list (rain-print-business: the towns box, names and addresses); see WORKER_ONLY above
  var WORKER_ONLY = { 'rain-print-business': 1 };

  // A worker that takes the post but never answers would leave the button on
  // "Sending..." for good (2026-10-14): after 12 seconds the post is given up
  // and goes to Formspree like any other worker failure.
  var TIMEOUT_MS = 12000;

  var OUTBOX_LABEL = { 'rain-print-business': 'your Rain Print business quote request' };
  function workerBody(kind, data) {
    var body = { kind: kind };
    Object.keys(data || {}).forEach(function (k) { body[k] = data[k]; });
    return body;
  }
  function toWorker(kind, data, ms) {
    var body = workerBody(kind, data);
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    var late = new Promise(function (resolve) {
      // 'slow': the worker may still have taken it, so the Formspree copy says it may repeat (panel 3 F11)
      timer = setTimeout(function () { if (ctl) ctl.abort(); resolve('slow'); }, ms || TIMEOUT_MS);
    });
    var sent = fetch(WORKER, {
      method: 'POST', body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
    }).then(function (r) {
      if (FALLBACK[r.status] || r.status >= 500) return 'fallback';
      return r.json().then(function (j) {
        if (r.ok && j && j.ok === true) return { ok: true, via: 'worker' };
        if (r.ok) return 'fallback';
        /* A worker older than the form (a new kind, not deployed yet) answers
           400 "unknown form": that is the worker missing, not the reader's
           mistake, so it goes to Formspree like a 404. */
        if (r.status === 400 && j && j.error === 'unknown form') return 'fallback';
        throw new Error('refused');
      }, function () {
        if (r.ok) return 'fallback';
        throw new Error('refused');
      });
    }, function () { return 'fallback'; });
    var done = function () { clearTimeout(timer); };
    sent.then(done, done);
    return Promise.race([sent, late]);
  }

  /* Formspree gets FORMSPREE_MS too (2026-10-14, panel 3 F11): a hung backup
     left the button on "Sending..." for good. */
  var FORMSPREE_MS = 15000, SLOW_TAG = ' (sent after the site form was slow; may repeat)';
  function toFormspree(fields, slow) {
    var fd = new FormData();
    Object.keys(fields || {}).forEach(function (k) {
      if (fields[k] !== undefined && fields[k] !== null) fd.append(k, k === '_subject' && slow ? fields[k] + SLOW_TAG : fields[k]);
    });
    if (slow && !(fields && fields._subject)) fd.append('_subject', 'AGSIST form' + SLOW_TAG);
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, FORMSPREE_MS);
    var o = { method: 'POST', body: fd, headers: { Accept: 'application/json' } };
    if (ctl) o.signal = ctl.signal;
    return fetch(FORMSPREE, o)
      .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
      .then(function (j) {
        clearTimeout(timer);
        if (!j || j.ok === false || j.errors) throw new Error('not sent');
        return { ok: true, via: 'formspree' };
      }, function (e) { clearTimeout(timer); throw e && e.message === 'not sent' ? e : new Error('not sent'); });
  }

  /* o.workerMs: a shorter wait for the worker than TIMEOUT_MS, for a press
     that has a checkout waiting on it (Rain Print's gift post, 4 s, 2026-10-22). */
  function post(kind, data, formspreeFields, o) {
    return toWorker(kind, data, o && o.workerMs).then(function (x) {
      if ((x === 'fallback' || x === 'slow') && WORKER_ONLY[kind]) {
        /* Kept in this browser instead (components/outbox.js, 2026-10-22):
           the list never leaves it until the worker itself answers again. */
        var kept = window.AgOutbox ? window.AgOutbox.add({ url: WORKER, body: workerBody(kind, data), kind: kind,
          label: OUTBOX_LABEL[kind] || 'your request' }) : '';
        if (kept) return { ok: true, via: 'outbox', queued: true, slow: x === 'slow' };
        var e = new Error('not sent'); e.workerOnly = true; e.slow = x === 'slow';
        throw e;
      }
      return x === 'fallback' || x === 'slow' ? toFormspree(formspreeFields || data, x === 'slow') : x;
    });
  }
  post.WORKER_ONLY = WORKER_ONLY;
  /* Straight to the backup form, for what the worker never takes (a Rain
     Print order record when the worker is out, 2026-10-22). Resolves
     {ok:true, via:'formspree'}, rejects when it didn't go. */
  post.formspree = function (fields) { return toFormspree(fields, false); };
  // the plain-HTML forms only need to know to fall back
  post.worker = function (kind, data) { return toWorker(kind, data).then(function (x) { return x === 'slow' ? 'fallback' : x; }); };
  window.agsistFormPost = post;
})();
