/* components/rp-forme.js -- "Rather not fiddle with it?" on /rain-print
   (Sig, 2026-10-30). A reader who would rather not make the print leaves a
   name, a phone or email, the place and who it is for; Sig calls or writes,
   makes two or three versions with the page as usual, and emails the design
   links (?d=). The reader opens one and orders it the normal way; the proof
   email is where they approve it. No charge for the help.

   It posts kind "rain-print-help" through components/form-post.js: the subs
   worker first, then the Formspree form when the worker does not know the
   kind yet or is down (scripts/form_digest.py names the kind). Nothing is
   kept in the browser. Pure helpers on window.AgsistRpForMe
   (test/rp-forme.test.mjs). No em dashes. */
(function (root) {
  'use strict';
  var KIND = 'rain-print-help', TO = 'sig@agsist.com', TEL = 'tel:+17157972428', PHONE = '(715) 797-2428';
  var MAX = { name: 80, contact: 254, place: 120, for_whom: 120, note: 1000 };
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, n); }
  /* A phone (7 to 15 digits) or an email address; '' when it is neither. */
  function contactKind(v) {
    v = String(v || '').trim();
    if (EMAIL.test(v)) return 'email';
    var d = v.replace(/\D/g, '');
    if (/^[\d\s().+-]+$/.test(v) && d.length >= 7 && d.length <= 15) return 'phone';
    return '';
  }
  /* {field: message} for what is missing or wrong; {} when it can go. */
  function check(x) {
    var e = {};
    if (!x.name) e.name = 'Your name, so I know who to ask for.';
    if (!x.contact) e.contact = 'A phone number or an email address.';
    else if (!contactKind(x.contact)) e.contact = 'That does not look like a phone number or an email address.';
    if (!x.place) e.place = 'The farm or town, and the state.';
    if (!x.for_whom) e.for_whom = 'Who the print is for.';
    return e;
  }
  function payload(x) {
    var p = { name: clean(x.name, MAX.name), contact: clean(x.contact, MAX.contact), place: clean(x.place, MAX.place),
      for_whom: clean(x.for_whom, MAX.for_whom), page: 'rain-print' };
    var n = String(x.note == null ? '' : x.note).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, MAX.note);
    if (n) p.note = n;
    return p;
  }
  function subject(p) { return 'Rain Print: make it for me, ' + p.name + ', ' + p.place; }
  function bodyText(p) {
    return ['Rain Print: please make it for me.', '', 'Name: ' + p.name, 'Phone or email: ' + p.contact,
      'The farm or town: ' + p.place, 'Who it is for: ' + p.for_whom].concat(p.note ? ['Note: ' + p.note] : []).join('\n');
  }
  var api = { KIND: KIND, contactKind: contactKind, check: check, payload: payload, subject: subject, bodyText: bodyText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgsistRpForMe = api;

  var doc = root.document;
  if (!doc || !doc.getElementById) return;
  var open = doc.getElementById('rp-fm-open'), f = doc.getElementById('rp-fm-form'), out = doc.getElementById('rp-fm-out');
  if (!open || !f || !out) return;
  var btn = doc.getElementById('rp-fm-submit');
  var IDS = { name: 'rp-fm-name', contact: 'rp-fm-contact', place: 'rp-fm-place', for_whom: 'rp-fm-for', note: 'rp-fm-note' };
  var $ = function (k) { return doc.getElementById(IDS[k]); };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var ga = function (name, o) { try { if (typeof root.gtag === 'function') root.gtag('event', name, o || {}); } catch (e) {} };

  open.addEventListener('click', function () {
    var show = f.hidden;
    f.hidden = !show;
    open.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) { try { $('name').focus(); } catch (e) {} ga('rain_print_help_open'); }
  });
  function fields() { var x = {}; Object.keys(IDS).forEach(function (k) { x[k] = $(k).value.trim(); }); return x; }
  function mark(errs) {
    Object.keys(IDS).forEach(function (k) {
      var el = $(k); if (!el) return;
      if (errs[k]) { el.setAttribute('aria-invalid', 'true'); el.title = errs[k]; } else { el.removeAttribute('aria-invalid'); el.removeAttribute('title'); }
    });
  }
  // a fix typed in takes the old "what is missing" line away
  f.addEventListener('input', function (ev) {
    if (!busy && out.querySelector('.rp-bad')) out.innerHTML = '';
    if (ev.target && ev.target.removeAttribute) { ev.target.removeAttribute('aria-invalid'); ev.target.removeAttribute('title'); }
  });
  var busy = false;
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy) return;
    var hp = doc.getElementById('rp-fm-hp');
    if (hp && hp.value) return;
    var x = fields(), errs = check(x), first = Object.keys(IDS).filter(function (k) { return errs[k]; })[0];
    mark(errs);
    if (first) {
      out.innerHTML = '<div class="rp-msg rp-bad"><p>' + esc(errs[first]) + '</p></div>';
      try { $(first).focus(); } catch (e) {}
      return;
    }
    var p = payload(x), fd = { _subject: subject(p), form: KIND };
    Object.keys(p).forEach(function (k) { fd[k] = p[k]; });
    if (contactKind(p.contact) === 'email') fd._replyto = p.contact;
    busy = true; btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = 'Sending…';
    out.innerHTML = '';
    var send = root.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
    send(KIND, p, fd).then(function () {
      ga('rain_print_help_submit', { result: 'ok' });
      f.hidden = true; open.setAttribute('aria-expanded', 'false');
      out.innerHTML = '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Thanks, I have it.</b> I&rsquo;ll get in touch at ' + esc(p.contact) +
        ', ask a few things about the print for ' + esc(p.for_whom) + ', and send you two or three versions to pick from. ' +
        'Nothing is charged unless you order one. Sig</p></div>';
      try { out.firstChild.focus(); } catch (e) {}
    }, function () {
      ga('rain_print_help_submit', { result: 'fail' });
      var href = 'mailto:' + TO + '?subject=' + encodeURIComponent(subject(p)) + '&body=' + encodeURIComponent(bodyText(p));
      out.innerHTML = '<div class="rp-msg rp-bad"><p><b>That did not go through, so nothing was sent.</b> Call or text me at <a href="' + TEL + '">' + PHONE +
        '</a>, or <a href="' + esc(href) + '">email it to me</a> (the message is written out for you).</p></div>';
    }).then(function () { busy = false; btn.disabled = false; btn.textContent = was; });
  });
})(typeof window !== 'undefined' ? window : this);
