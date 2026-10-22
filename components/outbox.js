/* components/outbox.js: what this browser still owes the subs worker
 * (Oct 22, 2026, after the Cloudflare block).
 *
 * A few things only the worker can finish: a gift card order (the card must
 * be checked and used once), a business quote (its customer list never goes
 * to the backup form, Sig's rule), a hay board post or change, an elevator's
 * bids, a watch confirm. When the worker is blocked or down, the page keeps
 * the request here, in this browser's storage, and says so in one plain
 * line. Nothing about it leaves this browser until the worker answers again.
 *
 *   AgOutbox.add({url, body, label, kind, expires, after, meta, okIf, method})
 *       -> id ('' when this browser cannot keep it: the page then says it
 *       did not go through, as before). body is sent as JSON (omit for a
 *       bare POST). label is what the reader is told about it later.
 *       expires: a time (ms) after which it is dropped unsent (an elevator's
 *       bids are only good the same morning). after: 'hay-mine' keeps the
 *       new post's edit link where the hay board page looks for it.
 *       okIf: 'ok' (default, the answer must be {ok:true}) or 'json' (any
 *       JSON answer without ok:false, for the /e front door routes).
 *   AgOutbox.flush() -> Promise of {sent, kept, refused}: sends what is kept,
 *       one at a time, each at most once. Runs by itself 1.5 s after any
 *       page loads with something kept (components/loader.js loads this file
 *       then), and when the browser comes back online.
 *   AgOutbox.list(), AgOutbox.blocked(status, isJson), AgOutbox.LINE
 *
 * When does a request count as not answered (kept for later)? No answer at
 * all, a page that is not JSON (Cloudflare's block page), a 429, or a 5xx.
 * A JSON refusal from a working worker (a used card, an expired link) is a
 * real answer: the item is dropped and the reader is told what it said.
 *
 * Never twice: one flush at a time across tabs (navigator.locks, else a
 * short lease in storage), and each item is marked as sending before it
 * goes, so a second tab skips it. Kept at most 30 items and 30 days.
 */
(function (root) {
  'use strict';
  if (root.AgOutbox) return;

  var KEY = 'agsist-outbox', LOCK = 'agsist-outbox-lock', MAX = 30, DAYS = 30, LEASE_MS = 60000, SEND_MS = 15000;
  var LINE = 'Saved. It will go through when our system is back and you next open agsist.com on this device; nothing else to do.';
  var CONTACT = 'sig@farmers1st.com';

  function now() { return Date.now(); }
  function read() {
    var a = null;
    try { a = JSON.parse(root.localStorage.getItem(KEY) || '[]'); } catch (e) { a = []; }
    var t = now();
    return (Array.isArray(a) ? a : []).filter(function (x) {
      return x && x.id && typeof x.url === 'string' && t - (x.t || 0) < DAYS * 86400000 && !(x.expires && t > x.expires);
    });
  }
  function write(a) {
    try {
      if (a.length) root.localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX)));
      else root.localStorage.removeItem(KEY);
      return true;
    } catch (e) { return false; }
  }
  function add(o) {
    if (!o || typeof o.url !== 'string' || !/^https:\/\/agsist-subs\.dnilgis\.workers\.dev\//.test(o.url)) return '';
    var id = now().toString(36) + Math.random().toString(36).slice(2, 8);
    var x = { id: id, t: now(), url: o.url, method: o.method || 'POST', label: String(o.label || 'What you saved').slice(0, 120),
      kind: o.kind || '', okIf: o.okIf === 'json' ? 'json' : 'ok' };
    if (o.body !== undefined) x.body = o.body;
    if (o.expires) x.expires = o.expires;
    if (o.after) x.after = o.after;
    if (o.meta) x.meta = o.meta;
    var a = read().concat([x]);
    if (!write(a)) return '';
    // read back: a full or blocked storage keeps nothing
    return read().some(function (y) { return y.id === id; }) ? id : '';
  }
  function drop(id) { write(read().filter(function (x) { return x.id !== id; })); }
  function mark(id, v) {
    var a = read(), hit = false;
    a.forEach(function (x) { if (x.id === id) { x.sending = v; hit = true; } });
    if (hit) write(a);
    return hit;
  }

  // a response that is not the worker's own answer: blocked, down or busy
  function blocked(status, isJson) {
    if (!status) return true;
    if (status === 429 || status >= 500) return true;
    return !isJson;
  }

  function send(x) {
    var ctl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, SEND_MS);
    var init = { method: x.method, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined,
      headers: { Accept: 'application/json' } };
    if (x.body !== undefined) { init.body = JSON.stringify(x.body); init.headers['Content-Type'] = 'application/json'; }
    return root.fetch(x.url, init).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (j) { return { status: r.status, ok: r.ok, json: true, j: j }; },
        function () { return { status: r.status, ok: r.ok, json: false, j: null }; });
    }, function () { clearTimeout(timer); return { status: 0, ok: false, json: false, j: null }; }).then(function (a) {
      if (blocked(a.status, a.json)) return { keep: true };
      var j = a.j && typeof a.j === 'object' ? a.j : {};
      var good = a.ok && (x.okIf === 'json' ? j.ok !== false : j.ok === true);
      return good ? { sent: true, j: j } : { refused: true, error: typeof j.error === 'string' ? j.error : (typeof j.title === 'string' ? j.title : '') };
    });
  }

  function afterSent(x, j) {
    if (x.after === 'hay-mine' && j && j.id && j.key) {
      try {
        var m = JSON.parse(root.localStorage.getItem('agsist-hay-mine') || '[]');
        m = (Array.isArray(m) ? m : []).filter(function (y) { return y && y.id !== j.id; });
        m.unshift({ id: j.id, key: j.key, kind: (x.meta && x.meta.kind) || 'sale', ts: now() });
        root.localStorage.setItem('agsist-hay-mine', JSON.stringify(m.slice(0, 20)));
      } catch (e) { /* the edit link is still in the worker's email-free record; the page can't show it */ }
    }
  }

  function bar(lines, bad) {
    try {
      var doc = root.document;
      if (!doc || !doc.body) return;
      var old = doc.getElementById('outbox-said'); if (old) old.remove();
      var b = doc.createElement('div');
      b.id = 'outbox-said'; b.setAttribute('role', 'status');
      b.style.cssText = 'background:' + (bad ? '#7a2414' : '#1f5130') + ';color:#fff;font-size:1rem;line-height:1.4;padding:10px 44px 10px 16px;position:fixed;left:0;right:0;bottom:0;z-index:9991;text-align:center;box-shadow:0 -2px 8px rgba(0,0,0,.25)';
      lines.forEach(function (t, i) { var p = doc.createElement('div'); p.textContent = t; if (i) p.style.marginTop = '4px'; b.appendChild(p); });
      var c = doc.createElement('button');
      c.type = 'button'; c.setAttribute('aria-label', 'Close'); c.textContent = '×';
      c.style.cssText = 'position:absolute;right:8px;top:8px;background:none;border:0;color:#fff;font-size:1.3rem;cursor:pointer;padding:4px 8px';
      c.addEventListener('click', function () { b.remove(); });
      b.appendChild(c);
      doc.body.appendChild(b);
      if (!bad) setTimeout(function () { if (b.parentNode) b.remove(); }, 15000);
    } catch (e) {}
  }

  function withLock(fn) {
    var L = root.navigator && root.navigator.locks;
    if (L && typeof L.request === 'function') {
      return L.request('agsist-outbox', { ifAvailable: true }, function (lock) { return lock ? fn() : null; });
    }
    var me = Math.random().toString(36).slice(2);
    try {
      var held = JSON.parse(root.localStorage.getItem(LOCK) || 'null');
      if (held && held.until > now()) return Promise.resolve(null);
      root.localStorage.setItem(LOCK, JSON.stringify({ who: me, until: now() + LEASE_MS }));
    } catch (e) { return Promise.resolve(null); }
    return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
      var held = null;
      try { held = JSON.parse(root.localStorage.getItem(LOCK) || 'null'); } catch (e) { held = null; }
      if (!held || held.who !== me) return null;   // another tab won the race
      return fn();
    }).then(function (v) {
      try { var h = JSON.parse(root.localStorage.getItem(LOCK) || 'null'); if (h && h.who === me) root.localStorage.removeItem(LOCK); } catch (e) {}
      return v;
    });
  }

  var running = null;
  function flush(opts) {
    if (running) return running;
    var quiet = opts && opts.quiet;
    running = Promise.resolve(withLock(function () {
      var out = { sent: [], kept: 0, refused: [] };
      var ids = read().map(function (x) { return x.id; });
      return ids.reduce(function (p, id) {
        return p.then(function () {
          var x = read().filter(function (y) { return y.id === id; })[0];
          if (!x) return;                                              // sent by another tab, or expired
          if (x.sending && now() - x.sending < LEASE_MS) { out.kept++; return; }
          if (!mark(id, now())) return;
          return send(x).then(function (r) {
            if (r.keep) { mark(id, 0); out.kept++; return 'stop'; }
            drop(id);
            if (r.sent) { afterSent(x, r.j); out.sent.push(x.label); }
            else out.refused.push(x.label + (r.error ? ': ' + r.error : ''));
          });
        }).then(function (s) { if (s === 'stop') throw out; });     // still blocked: the rest waits too
      }, Promise.resolve()).then(function () { return out; }, function (o) { if (o === out) return out; throw o; });
    })).then(function (out) {
      running = null;
      out = out || { sent: [], kept: 0, refused: [] };
      if (!quiet) {
        if (out.refused.length) bar(['Something you saved while our system was down did not go through.'].concat(out.refused,
          ['Write to ' + CONTACT + ' if you need a hand.']), true);
        else if (out.sent.length) bar(['Sent now that our system is back: ' + out.sent.join('; ') + '.']);
      }
      return out;
    }, function () { running = null; return { sent: [], kept: read().length, refused: [] }; });
    return running;
  }

  root.AgOutbox = { add: add, flush: flush, list: read, drop: drop, blocked: blocked, LINE: LINE, KEY: KEY };

  if (root.document && read().length) setTimeout(function () { flush(); }, 1500);
  if (root.addEventListener) root.addEventListener('online', function () { if (read().length) flush(); });
})(typeof window !== 'undefined' ? window : this);
