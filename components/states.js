/* components/states.js: loading, empty, error and stale states (window.AgStates).
   Styles in components/states.css. loader.js puts both on every page; a page
   that calls AgStates from its own script loads this file itself with defer.

   AgStates.skeleton(el, shape)   gray blocks shaped like the content.
       shape: a number (that many text lines), or {lines:n}, {rows:n, h:px},
       {cards:n, h:px}, {fill:true} (fills a reserved box), {num:true} (one
       number inside a sentence). The element keeps the height the page gave it.
   AgStates.error(el, {msg, retry, inline})
       "Prices didn't load." plus a button that runs retry(). No retry, no button.
   AgStates.empty(el, msg)        a plain sentence where data would be.
   AgStates.done(el)              clears the busy flag after the page renders.
   AgStates.load(el, {url | get, render, shape, msg, timeout})
       skeleton, fetch, render(data); on failure the error box, and its retry
       starts over. Returns the promise.
   AgStates.ago(iso)              "12 min ago", "3 hours ago", "2 days ago".
   AgStates.stale(el, iso, {maxHours, what})
       when the feed is older than maxHours, writes "<what> is 2 days old" into
       el and returns true. Fresh: leaves el alone and returns false.
   window.AgStatesQ.push(fn)
       runs fn once this file has loaded (at once if it already has). A page
       that fails before then writes its plain text first and queues fn.

   Honest by construction: nothing here makes up a number or hides one. */
(function () {
  'use strict';
  if (window.AgStates) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el$(el) { return typeof el === 'string' ? document.getElementById(el) || document.querySelector(el) : el; }
  function coarse() { try { return window.matchMedia('(pointer:coarse)').matches; } catch (e) { return false; } }

  function shapeHtml(shape) {
    if (shape == null) shape = 3;
    if (typeof shape === 'number') shape = { lines: shape };
    var i, h = '';
    if (shape.fill) return '<span class="st-sk st-fill" aria-hidden="true"></span>';
    if (shape.num) return '<span class="st-sk st-num" aria-hidden="true"></span>';
    if (shape.big) return '<span class="st-sk st-big" aria-hidden="true"></span>';
    if (shape.rows) {
      for (i = 0; i < shape.rows; i++) h += '<span class="st-sk st-row"' + (shape.h ? ' style="--st-row-h:' + (+shape.h) + 'px"' : '') + '></span>';
      return '<span class="st-rows" aria-hidden="true">' + h + '</span>';
    }
    if (shape.cards) {
      for (i = 0; i < shape.cards; i++) h += '<span class="st-sk st-card"' + (shape.h ? ' style="--st-card-h:' + (+shape.h) + 'px"' : '') + ' aria-hidden="true"></span>';
      return h;
    }
    var n = Math.max(1, shape.lines | 0);
    var w = ['', 'st-w90', 'st-w75', '', 'st-w90'];
    for (i = 0; i < n; i++) h += '<span class="st-sk st-line ' + (i < n - 1 ? w[i % w.length] : '') + '" aria-hidden="true"></span>';
    return h;
  }

  function skeleton(el, shape) {
    el = el$(el); if (!el) return;
    el.setAttribute('aria-busy', 'true');
    el.innerHTML = shapeHtml(shape);
  }

  function done(el) { el = el$(el); if (el) el.removeAttribute('aria-busy'); }

  function error(el, o) {
    el = el$(el); if (!el) return;
    o = o || {};
    var msg = o.msg || 'This didn’t load.';
    var fill = !!o.fill, inline = !!o.inline;
    el.removeAttribute('aria-busy');
    el.innerHTML = (inline ? '<span class="st-inline" role="status">' : '<div class="st-msg' + (fill ? ' st-msg--fill' : '') + '" role="status"><p>') +
      esc(msg) + (inline ? '' : '</p>') +
      (typeof o.retry === 'function' ? '<button type="button" class="st-retry">' + (coarse() ? 'Tap to try again' : 'Try again') + '</button>' : '') +
      (inline ? '</span>' : '</div>');
    var b = el.querySelector('.st-retry');
    if (b) b.addEventListener('click', function () {
      b.disabled = true; b.textContent = 'Trying…';
      try { o.retry(); } catch (e) { b.disabled = false; b.textContent = 'Try again'; }
    });
  }

  function empty(el, msg, o) {
    el = el$(el); if (!el) return;
    o = o || {};
    el.removeAttribute('aria-busy');
    el.innerHTML = o.inline ? '<span class="st-inline">' + esc(msg) + '</span>'
                            : '<div class="st-msg' + (o.fill ? ' st-msg--fill' : '') + '"><p>' + esc(msg) + '</p></div>';
  }

  function fetchJSON(url, o) {
    o = o || {};
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, o.timeout || 15000) : 0;
    return fetch(url, { cache: o.cache || 'no-cache', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { clearTimeout(t); return d; }, function (e) { clearTimeout(t); throw e; });
  }

  function load(el, o) {
    el = el$(el); if (!el) return Promise.resolve();
    skeleton(el, o.shape);
    var p = o.get ? Promise.resolve().then(o.get) : fetchJSON(o.url, o);
    return p.then(function (d) { done(el); return o.render(d, el); })
      .catch(function (e) {
        error(el, { msg: o.msg, fill: o.fill, retry: function () { load(el, o); } });
        if (o.onError) try { o.onError(e); } catch (x) {}
      });
  }

  function ago(iso) {
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 2) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 36) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function age(iso) {
    var t = new Date(iso).getTime();
    var h = (Date.now() - t) / 36e5;
    if (h < 36) { var hh = Math.max(1, Math.round(h)); return hh + (hh === 1 ? ' hour' : ' hours'); }
    var d = Math.round(h / 24); return d + (d === 1 ? ' day' : ' days');
  }
  function stale(el, iso, o) {
    o = o || {};
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return false;
    if ((Date.now() - t) / 36e5 <= (o.maxHours || 24)) return false;
    el = el$(el);
    if (el) el.innerHTML = '<span class="st-stale">' + esc((o.what || 'This feed') + ' is ' + age(iso) + ' old') + '</span>';
    return true;
  }

  window.AgStates = { skeleton: skeleton, shape: shapeHtml, done: done, error: error, empty: empty, load: load, fetchJSON: fetchJSON, ago: ago, age: age, stale: stale };

  /* A page's own script can fail a fetch before this deferred file has run
     (an offline phone fails at once). It then writes its plain fallback and
     queues the same step: (window.AgStatesQ = window.AgStatesQ || []).push(fn).
     Here the queue runs, and anything pushed later runs at once. */
  var q = window.AgStatesQ;
  window.AgStatesQ = { push: function (f) { try { f(); } catch (e) {} } };
  if (q && q.length) for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) {} }
})();
