/* The site's three forms (elevator claim, sponsor proof approval and
 * requests, Parcel Report waitlist), 2026-10-11.
 *
 * They post to AGSIST's own subs worker (POST /form, workers/subs-worker.js
 * v5.8), which stores them; scripts/form_digest.py mails Sig. Until Sig
 * deploys that worker version the route does not exist, so whenever the
 * worker answers 403, 404, 405 or 5xx, does not answer, or the browser cannot
 * read the answer, the same post goes to the Formspree form these pages used
 * before. A refusal the worker means (400 bad field, 429 too many) is passed
 * back to the page, which shows its own "did not go through" message.
 *
 *   agsistFormPost(kind, data, formspreeFields) -> Promise
 *     resolves {ok:true, via:'worker'|'formspree'}, rejects when neither took it.
 *     formspreeFields is what goes to Formspree (defaults to data).
 *   agsistFormPost.worker(kind, data) -> Promise
 *     resolves {ok:true, via:'worker'} or the string 'fallback'; rejects on a
 *     refusal. For a plain HTML form that falls back by submitting itself.
 */
(function () {
  'use strict';
  var WORKER = 'https://agsist-subs.dnilgis.workers.dev/form';
  var FORMSPREE = 'https://formspree.io/f/xnjbwepn';
  var FALLBACK = { 403: 1, 404: 1, 405: 1 };

  function toWorker(kind, data) {
    var body = { kind: kind };
    Object.keys(data || {}).forEach(function (k) { body[k] = data[k]; });
    return fetch(WORKER, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
    }).then(function (r) {
      if (FALLBACK[r.status] || r.status >= 500) return 'fallback';
      return r.json().then(function (j) {
        if (r.ok && j && j.ok === true) return { ok: true, via: 'worker' };
        if (r.ok) return 'fallback';
        throw new Error('refused');
      }, function () {
        if (r.ok) return 'fallback';
        throw new Error('refused');
      });
    }, function () { return 'fallback'; });
  }

  function toFormspree(fields) {
    var fd = new FormData();
    Object.keys(fields || {}).forEach(function (k) {
      if (fields[k] !== undefined && fields[k] !== null) fd.append(k, fields[k]);
    });
    return fetch(FORMSPREE, { method: 'POST', body: fd, headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
      .then(function (j) {
        if (!j || j.ok === false || j.errors) throw new Error('not sent');
        return { ok: true, via: 'formspree' };
      });
  }

  function post(kind, data, formspreeFields) {
    return toWorker(kind, data).then(function (x) {
      return x === 'fallback' ? toFormspree(formspreeFields || data) : x;
    });
  }
  post.worker = toWorker;
  window.agsistFormPost = post;
})();
