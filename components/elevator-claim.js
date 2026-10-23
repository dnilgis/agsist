/* "Fix your listing" (claim your board) on /list-your-elevator#claim; on /elevators until Oct 22, 2026. */
/* ===== 2026-10-01 r7-claim: "Claim your board" form =====
   WHERE IT GOES (2026-10-11): AGSIST's subs worker (POST /form, kind claim)
   through components/form-post.js; the digest job mails Sig. If the worker
   cannot take it (not deployed yet, down), the helper sends the same fields
   to the site's Formspree form, the one this used before. Fields:
   _subject, form, elevator, town, state, contact_name, role, email, phone,
   bid_page_url, hosted_board, page (+ the _gotcha honeypot). Nothing else.
   IF IT FAILS the page says nothing was sent and hands over the same text as
   a prefilled email and as text to copy. A claim that quietly vanishes is the
   worst thing this form could do.
   ANALYTICS: claim_submit with result ok|fail. No field values, ever. */
(function () {
  'use strict';
  var TO = 'sig@agsist.com';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var f = document.getElementById('cl-form');
  var out = document.getElementById('cl-out');
  var sec = document.getElementById('claim');
  if (!f || !out || !sec) return;
  function ga(n, p) { try { if (window.gaEvent) window.gaEvent(n, p); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function v(n) { var e = f.elements[n]; return e ? String(e.value || '').trim() : ''; }

  /* ---- network counts, from the file the coverage map already reads ---- */
  function fmtCT(iso) {
    var t = Date.parse(iso || '');
    if (isNaN(t)) return '';
    try {
      var d = new Date(t);
      var day = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' });
      var tm = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
      return day + ', ' + tm + ' CT';
    } catch (e) { return ''; }
  }
  function paintNet(d) {
    var el = document.getElementById('cl-net');
    var n = d && d.counts;
    if (!el || !n || typeof n.read !== 'number' || typeof n.known !== 'number') return;
    var when = fmtCT(d.directoryGenerated || d.generated);
    el.innerHTML = 'In the read ' + (when ? 'of ' + esc(when) : 'this page was built from') +
      ', AGSIST read <span class="num">' + n.read.toLocaleString('en-US') + '</span> elevator boards direct. ' +
      /* wave1-E: the quiet boards are counted too, from the same file (counts.quiet). */
      (typeof n.quiet === 'number' && n.quiet > 0 ? '<span class="num">' + n.quiet.toLocaleString('en-US') + '</span> more have a reader that did not answer that pass. ' : '') +
      'It knows <span class="num">' + n.known.toLocaleString('en-US') + '</span> more elevators that have no reader yet. ' +
      '<a href="#coverage-map">See the map</a>.';
  }
  /* /elevators#claim: the map and its counts load after the browser has
     jumped to the anchor and push the section down. Put it back in view once
     they settle, unless the reader has already started scrolling. */
  var moved = false;
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) {
    window.addEventListener(ev, function () { moved = true; }, { passive: true, once: true });
  });
  function reland() {
    if (moved || location.hash !== '#claim') return;
    var top = sec.getBoundingClientRect().top;
    if (Math.abs(top - 84) > 24) { try { sec.scrollIntoView(); } catch (e) {} }
  }
  function paintNetAndLand(d) { paintNet(d); setTimeout(reland, 250); }
  window.__agClaimNet = paintNetAndLand;
  if (window.__agCov) paintNetAndLand(window.__agCov);
  window.addEventListener('load', function () { setTimeout(reland, 600); setTimeout(reland, 2000); });

  var btn = document.getElementById('cl-send');

  /* ---- validation ---- */
  var RULES = {
    elevator: function (s) { return s ? '' : 'Enter the elevator or co-op name.'; },
    town: function (s) { return s ? '' : 'Enter the town.'; },
    state: function (s) { return s ? '' : 'Choose a state.'; },
    contact_name: function (s) { return s ? '' : 'Enter your name.'; },
    role: function (s) { return s ? '' : 'Enter your role, for example manager or merchandiser.'; },
    email: function (s) {
      if (!s) return 'Enter your work email.';
      return EMAIL_RE.test(s) && s.length <= 254 ? '' : 'That email does not look complete. Check it for a typo.';
    },
    phone: function (s) {
      if (!s) return '';
      var d = s.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 15 ? '' : 'Enter a full phone number with area code, or leave it blank.';
    },
    bid_page_url: function (s) {
      if (!s) return '';
      var u = /^https?:\/\//i.test(s) ? s : 'https://' + s;
      try { var p = new URL(u); return /\./.test(p.hostname) ? '' : 'Enter a full web address, or leave it blank.'; }
      catch (e) { return 'Enter a full web address, or leave it blank.'; }
    }
  };
  function check(name) {
    var inp = f.elements[name];
    if (!inp) return '';
    var msg = RULES[name](v(name));
    var err = document.getElementById(inp.id + '-e');
    if (err) err.textContent = msg;
    if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
    return msg;
  }
  Object.keys(RULES).forEach(function (name) {
    var inp = f.elements[name];
    if (!inp) return;
    /* Not when focus is moving to the submit button: an error line appearing
       on mousedown pushes the button down and the click misses it. The
       submit handler checks every field anyway. */
    inp.addEventListener('blur', function (ev) {
      if (ev.relatedTarget === btn) return;
      if (v(name) || inp.getAttribute('aria-invalid')) check(name);
    });
    inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', function () {
      if (inp.getAttribute('aria-invalid')) check(name);
    });
  });

  function normUrl(s) { return !s ? '' : (/^https?:\/\//i.test(s) ? s : 'https://' + s); }
  function fields() {
    return {
      elevator: v('elevator'), town: v('town'), state: v('state'),
      contact_name: v('contact_name'), role: v('role'), email: v('email'),
      phone: v('phone'), bid_page_url: normUrl(v('bid_page_url')),
      hosted_board: f.elements.hosted_board && f.elements.hosted_board.checked ? 'yes' : 'no'
    };
  }
  function subject(x) { return 'Claim your board: ' + x.elevator + ', ' + x.town + ' ' + x.state; }
  function bodyText(x) {
    return [
      'Elevator or co-op: ' + x.elevator,
      'Town: ' + x.town,
      'State: ' + x.state,
      '',
      'Contact: ' + x.contact_name,
      'Role: ' + x.role,
      'Work email: ' + x.email,
      'Phone: ' + (x.phone || '(not given)'),
      'Bid page: ' + (x.bid_page_url || '(not given)'),
      '',
      'Tell me about a hosted bid board: ' + x.hosted_board,
      '',
      'Sent from agsist.com/list-your-elevator#claim'
    ].join('\n');
  }

  var busy = false;
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    if (f.elements._gotcha && f.elements._gotcha.value) return;
    var first = null;
    Object.keys(RULES).forEach(function (name) {
      if (check(name) && !first) first = f.elements[name];
    });
    if (first) { try { first.focus(); } catch (err) {} return; }

    var x = fields();
    /* What Formspree gets if the worker cannot take it: the same fields as before. */
    var fd = { _subject: subject(x), form: 'claim-board' };
    Object.keys(x).forEach(function (k) { fd[k] = x[k]; });
    fd.page = '/list-your-elevator#claim';
    busy = true;
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = 'Sending…';
    out.innerHTML = '';

    var wx = { page: '/list-your-elevator#claim' };
    Object.keys(x).forEach(function (k) { wx[k] = x[k]; });
    var send = window.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
    send('claim', wx, fd)
      .then(function () {
        ga('claim_submit', { result: 'ok' });
        sec.classList.add('sent');
        out.innerHTML = '<div class="cl-msg ok"><p><b>Sent.</b> Sig has your claim for ' + esc(x.elevator) +
          ' in ' + esc(x.town) + ', ' + esc(x.state) + '.</p><p>He replies to ' + esc(x.email) +
          ' to confirm you work there. Nothing changes on the site until then.</p></div>';
        try { out.querySelector('.cl-msg').setAttribute('tabindex', '-1'); out.querySelector('.cl-msg').focus(); } catch (err) {}
      })
      .catch(function () {
        ga('claim_submit', { result: 'fail' });
        var body = bodyText(x);
        var href = 'mailto:' + TO + '?subject=' + encodeURIComponent(subject(x)) + '&body=' + encodeURIComponent(body);
        out.innerHTML = '<div class="cl-msg bad"><p><b>That did not go through. Nothing was sent.</b></p>' +
          '<p>Send it by email instead. The message is written out for you, addressed to ' + TO + '.</p>' +
          '<div class="cl-acts"><a class="cl-btn2" id="cl-mail" href="' + esc(href) + '">Email it instead</a>' +
          '<button type="button" class="cl-btn2" id="cl-copy">Copy the message</button></div>' +
          '<textarea id="cl-copy-ta" readonly rows="9" aria-label="Your claim, as text">' + esc(body) + '</textarea></div>';
        /* The submit button is disabled while sending, so focus fell to the
           page body. Put it on the way out instead (panel F25). */
        var ml = document.getElementById('cl-mail');
        if (ml) { try { ml.focus(); } catch (err) {} }
        var cp = document.getElementById('cl-copy');
        if (cp) cp.addEventListener('click', function () {
          var ta = document.getElementById('cl-copy-ta');
          if (!ta) return;
          var done = function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy the message'; }, 2000); };
          ta.select();
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (err) {} });
          else { try { document.execCommand('copy'); done(); } catch (err) {} }
        });
      })
      .then(function () { busy = false; btn.disabled = false; btn.textContent = was; });
  });
})();
