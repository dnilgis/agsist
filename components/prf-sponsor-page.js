/* components/prf-sponsor-page.js: the live preview and the inquiry form on
   /prf-sponsor (prf-sponsor.html).

   A business types its name, one line, phone and website, ticks the states it
   wants, and sees its block drawn by the same code the PRF pages use
   (window.AgPrfSponsor.render, components/prf-sponsor.js), so the preview is
   exactly what would show. The inquiry posts to the subs worker (POST /form,
   kind prf-sponsor, worker v5.22) through components/form-post.js;
   scripts/form_digest.py mails Sig with the subject
   "PRF sponsor inquiry: <business> (<states>)". Nothing is published from an
   inquiry, and no price is printed, suggested or sent from here.

   ?state=IA (the links on the PRF state pages, county pages, /prf and the
   sponsor sheet) ticks that state. Only a code that is one of the page's own
   state boxes is used; anything else in the link is ignored.
   With a state ticked from the link, the 48 boxes fold behind "Add more
   states" (2026-10-20: on a phone the list put Send about 20 screens' worth of
   boxes down); the line above the button names what is ticked. Without
   ?state= the list stays open as before.

   The pure parts are on window.PrfSponsorPage and under module.exports, so
   test/prf-sponsor-page.test.mjs runs the same code the page runs. */
(function (root) {
  'use strict';

  var TO = 'sig@agsist.com';
  var PAGE = '/prf-sponsor';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var MAX = { business: 120, name: 80, email: 254, phone: 30, line: 120, website: 320, message: 1000 };
  var NOT_IN_A_SLOT = /farmers\s*(1st|first)/i;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* One line, no control characters. */
  function clean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* ?state=ia or ?state=IA,NE -> the known codes, each once, in the order given. */
  function prefill(search, known) {
    var q, out = [];
    try { q = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch (e) { return out; }
    var raw = q.getAll('state').join(',');
    raw.split(/[,;\s]+/).forEach(function (c) {
      c = clean(c).toUpperCase();
      if (c && known[c] && out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }

  /* The website as the worker stores it: https:// added when left off; '' when it is not a web address. */
  function site(v) {
    v = clean(v);
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { var u = new URL(v); if (!/^https?:$/.test(u.protocol) || u.hostname.indexOf('.') < 0) return ''; } catch (e) { return ''; }
    return /^https?:\/\/[^\s"'<>\\`]+$/i.test(v) ? v : '';
  }

  /* Field rules, the same as the worker's. Returns '' or the message to show. */
  var RULES = {
    business: function (s) {
      if (!s) return 'Enter your business name.';
      if (s.length > MAX.business) return 'Keep the name under 120 letters.';
      return NOT_IN_A_SLOT.test(s) ? 'That name cannot take a slot.' : '';
    },
    line: function (s) { return s.length > MAX.line ? 'Keep the line to 120 characters.' : ''; },
    phone: function (s) {
      if (!s) return '';
      return /^[0-9+().\-\s]+$/.test(s) && s.replace(/\D/g, '').length >= 10 && s.length <= MAX.phone ? '' : 'Enter a full phone number with area code, or leave it blank.';
    },
    website: function (s) { return !s || site(s) ? '' : 'That does not look like a web address. Leave it blank if you like.'; },
    states: function (a) { return a && a.length ? '' : 'Tick at least one state.'; },
    name: function (s) { return !s ? 'Enter your name.' : s.length > MAX.name ? 'Keep your name under 80 letters.' : ''; },
    email: function (s) {
      if (!s) return 'Enter your email so Sig can reply.';
      return EMAIL_RE.test(s) && s.length <= MAX.email ? '' : 'That email does not look complete. Check it for a typo.';
    },
    message: function (s) { return s.length > MAX.message ? 'Keep the message under 1,000 letters.' : ''; }
  };
  function check(x) {
    var errs = {};
    Object.keys(RULES).forEach(function (k) { var m = RULES[k](x[k] == null ? '' : x[k]); if (m) errs[k] = m; });
    return errs;
  }

  /* What goes to the worker: states A to Z, empty optional fields left out. */
  function payload(x) {
    var p = { business: x.business, name: x.name, email: x.email, states: (x.states || []).slice().sort().join(', '), page: PAGE };
    if (x.phone) p.phone = x.phone;
    if (x.line) p.line = x.line;
    var w = site(x.website);
    if (w) p.website = w;
    if (x.message) p.message = x.message;
    return p;
  }
  function subject(p) { return 'PRF sponsor inquiry: ' + p.business + ' (' + p.states + ')'; }
  function bodyText(p) {
    var l = ['Business: ' + p.business, 'States: ' + p.states, '', 'Contact: ' + p.name, 'Email: ' + p.email];
    if (p.phone) l.push('Phone: ' + p.phone);
    if (p.website) l.push('Website: ' + p.website);
    if (p.line) l.push('Their line: ' + p.line);
    if (p.message) l.push('Message: ' + p.message);
    return l.concat(['', 'Sent from agsist.com' + PAGE]).join('\n');
  }

  /* The sponsor object prf-sponsor.js draws, from what is typed so far.
     Empty fields show sample words, so the block is never blank. */
  var SAMPLE = { name: 'Your Business', line: 'Your one line goes here, up to 120 characters.' };
  function previewSp(x, st) {
    return {
      st: st || 'XX',
      name: clean(x.business).slice(0, 60) || SAMPLE.name,
      url: site(x.website) || 'https://agsist.com/prf-sponsor',
      line: clean(x.line).slice(0, MAX.line) || SAMPLE.line,
      logo: '',
      phone: RULES.phone(clean(x.phone)) ? '' : clean(x.phone),
      through: ''
    };
  }

  /* The line over "Add more states" when the list is folded: 'Ticked: Iowa.' or 'Ticked: Iowa and Kansas.' */
  function pickedLine(names) {
    names = (names || []).filter(Boolean);
    if (!names.length) return 'No state ticked yet.';
    return 'Ticked: ' + (names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]) + '.';
  }

  var api = { pickedLine: pickedLine, prefill: prefill, site: site, check: check, payload: payload, subject: subject, bodyText: bodyText,
    previewSp: previewSp, clean: clean, esc: esc, RULES: RULES, MAX: MAX, SAMPLE: SAMPLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PrfSponsorPage = api;

  /* ---------------- the page ---------------- */
  if (typeof document === 'undefined') return;
  var f = document.getElementById('ps-form');
  var out = document.getElementById('ps-out');
  var sec = document.getElementById('ask');
  if (!f || !out || !sec) return;
  var btn = document.getElementById('ps-send');
  function ga(n, p) { try { if (window.gaEvent) window.gaEvent(n, p); } catch (e) {} }

  /* The state boxes on the page are the list: code -> {name, counties}. */
  var boxes = f.querySelectorAll('input[name="states"]');
  var known = {};
  Array.prototype.forEach.call(boxes, function (b) {
    known[b.value] = { name: b.getAttribute('data-name') || b.value, n: +b.getAttribute('data-counties') || 0 };
  });
  var last = '';   // the state the preview shows: the one ticked last, else the first ticked

  var pre = prefill(root.location ? root.location.search : '', known);
  pre.forEach(function (c) { var b = f.querySelector('input[name="states"][value="' + c + '"]'); if (b) b.checked = true; });
  if (pre.length) last = pre[0];
  var from = document.getElementById('ps-from');
  if (from && pre.length) {
    from.textContent = (pre.length === 1 ? known[pre[0]].name + ' is' : pre.map(function (c) { return known[c].name; }).join(', ') + ' are') +
      ' ticked in the form below. Add any other states you want there.';
    from.hidden = false;
  }
  /* Folded: the boxes hide behind "Add more states" until it is pressed (then they stay open). */
  var list = document.getElementById('ps-states-list'), more = document.getElementById('ps-more'), picked = document.getElementById('ps-picked');
  var folded = !!(pre.length && list && more && picked);
  function syncPicked() {
    if (!folded) return;
    picked.textContent = pickedLine(ticked().map(function (c) { return known[c] ? known[c].name : c; }));
  }
  if (folded) {
    list.hidden = true; more.hidden = false; picked.hidden = false;
    syncPicked();
    more.addEventListener('click', function () {
      folded = false; list.hidden = false; more.hidden = true; picked.hidden = true;
      more.setAttribute('aria-expanded', 'true');
      try { list.querySelector('input').focus(); } catch (e) {}
    });
  }

  function v(n) { var e = f.elements[n]; return e && typeof e.value === 'string' ? String(e.value).trim() : ''; }
  function ticked() {
    var a = [];
    Array.prototype.forEach.call(f.querySelectorAll('input[name="states"]:checked'), function (c) { a.push(c.value); });
    return a;
  }
  function fields() {
    return { business: v('business'), line: v('line'), phone: v('phone'), website: v('website'), states: ticked(),
      name: v('name'), email: v('email'), message: v('message') };
  }

  /* The preview: the state page block, the county page line and the /prf result box, all from prf-sponsor.js. */
  var pv = document.getElementById('ps-preview');
  var where = document.getElementById('ps-where');
  var nState = document.getElementById('ps-pick');
  function draw() {
    var R = root.AgPrfSponsor;
    if (!pv || !R || typeof R.render !== 'function') return;
    syncPicked();
    var t = ticked();
    if (t.indexOf(last) < 0) last = t[0] || '';
    if (nState && nState.value !== last) nState.value = last;
    var info = known[last];
    var stName = info ? info.name : 'your state';
    var sp = previewSp(fields(), last);
    var slots = pv.querySelectorAll('[data-ps-kind]');
    Array.prototype.forEach.call(slots, function (el) {
      var kind = el.getAttribute('data-ps-kind');
      el.className = 'ag-sponsor-ribbon ag-sponsor-ribbon--sold prf-spon prf-spon-' + kind;
      /* no click tracking on a preview: sponsor click counts are for real sponsors only */
      el.innerHTML = R.render(sp, stName, kind).replace(/ data-sponsor-click="[^"]*"/g, '').replace(/ target="_blank"/g, '');
    });
    if (where) {
      where.innerHTML = info
        ? 'Shown here for ' + esc(info.name) + ': on <a href="/prf/' + esc(info.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '">the ' + esc(info.name) +
          ' PRF page</a>, on all ' + info.n.toLocaleString('en-US') + ' ' + esc(info.name) + ' county pages, and beside the result on <a href="/prf">/prf</a> when a reader&rsquo;s grid is in ' + esc(info.name) + '.'
        : 'Tick a state below to see it with that state&rsquo;s name and county count.';
    }
  }
  /* A click on the sample button goes nowhere: it is a preview. */
  if (pv) pv.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); });
  if (nState) {
    nState.addEventListener('change', function () {
      var c = nState.value;
      if (c && known[c]) {
        var b = f.querySelector('input[name="states"][value="' + c + '"]');
        if (b && !b.checked) b.checked = true;
        last = c;
      }
      draw();
    });
  }

  function target(k) { return k === 'states' ? f.querySelector('input[name="states"]') : f.elements[k]; }
  function mark(errs, only) {
    Object.keys(RULES).forEach(function (k) {
      if (only && k !== only) return;
      var err = document.getElementById('ps-' + k + '-e'), inp = target(k);
      if (err) err.textContent = errs[k] || '';
      if (inp && k !== 'states') { if (errs[k]) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
    });
  }
  /* Errors show when Send is pressed; after that a field's line updates as it is typed in. */
  Object.keys(RULES).forEach(function (k) {
    var group = k === 'states' ? boxes : [f.elements[k]];
    Array.prototype.forEach.call(group, function (inp) {
      if (!inp) return;
      var again = function () {
        if (k === 'states' && inp.checked) last = inp.value;
        draw();
        var e = document.getElementById('ps-' + k + '-e');
        if (e && e.textContent) mark(check(fields()), k);
      };
      inp.addEventListener('change', again);
      inp.addEventListener('input', again);
    });
  });
  [['line', 120], ['message', 1000]].forEach(function (c) {
    var el = f.elements[c[0]], n = document.getElementById('ps-' + c[0] + '-n');
    if (el && n) el.addEventListener('input', function () { n.textContent = el.value.length + ' / ' + c[1]; });
  });
  if (root.AgPrfSponsor) draw();
  else root.addEventListener('load', draw);

  var busy = false;
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    if (f.elements._gotcha && f.elements._gotcha.value) return;
    var x = fields(), errs = check(x);
    mark(errs);
    var first = Object.keys(RULES).filter(function (k) { return errs[k]; })[0];
    if (first === 'states' && folded) more.click();
    if (first) { try { target(first).focus(); } catch (err) {} return; }
    var p = payload(x);
    var fd = { _subject: subject(p), form: 'prf-sponsor' };
    Object.keys(p).forEach(function (k) { fd[k] = p[k]; });
    busy = true; btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = 'Sending…';
    out.innerHTML = '';
    var send = root.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
    send('prf-sponsor', p, fd)
      .then(function () {
        ga('prf_sponsor_inquiry', { result: 'ok', states: x.states.length });
        sec.classList.add('sent');
        out.innerHTML = '<div class="cl-msg ok"><p><b>Sent.</b> Sig has your note about PRF in ' + esc(p.states) + ' for ' + esc(p.business) + '.</p>' +
          '<p>He replies to ' + esc(p.email) + ' with the price for those states and how to pay. Nothing goes on the site until you say yes and it is paid. ' +
          'Questions: <a href="mailto:' + TO + '">' + TO + '</a> or 715-797-2428.</p></div>';
        try { var m = out.querySelector('.cl-msg'); m.setAttribute('tabindex', '-1'); m.focus(); } catch (err) {}
      })
      .catch(function () {
        ga('prf_sponsor_inquiry', { result: 'fail' });
        var body = bodyText(p);
        var href = 'mailto:' + TO + '?subject=' + encodeURIComponent(subject(p)) + '&body=' + encodeURIComponent(body);
        out.innerHTML = '<div class="cl-msg bad"><p><b>That did not go through. Nothing was sent.</b></p>' +
          '<p>Send it by email instead. The message is written out for you, addressed to ' + TO + '.</p>' +
          '<div class="cl-acts"><a class="cl-btn2" id="ps-mail" href="' + esc(href) + '">Email it instead</a></div>' +
          '<textarea id="ps-copy-ta" readonly rows="8" aria-label="Your note, as text">' + esc(body) + '</textarea></div>';
        var ml = document.getElementById('ps-mail');
        if (ml) { try { ml.focus(); } catch (err) {} }
      })
      .then(function () { busy = false; btn.disabled = false; btn.textContent = was; });
  });
})(typeof window !== 'undefined' ? window : globalThis);
