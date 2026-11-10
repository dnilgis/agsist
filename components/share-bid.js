/* Share today's bids, on the cash-bid town pages (scripts/build_cash_bid_pages.py,
 * share_bid_html). Nov 3, 2026.
 *
 * The page carries the button and everything it shares: data-text names the
 * page's own headline bid (the row the answer line names, with the day it was
 * posted), data-plain is the town link with no price, and data-until is the
 * moment that bid stops counting (its freshness window or the end of its
 * delivery period). After that moment only data-plain is shared, so a page read
 * days later never passes on an old price as today's. No futures price, no basis.
 *
 * Phones with the share sheet get it, with the text minus its bare link and the
 * tagged link once in the url field (Nov 3). Otherwise one tap shows "Copy" and, on a
 * phone, "Text it" (an sms: link). The link carries utm_source=share and nothing
 * about the reader. One GA4 event, share_bid, with what was done.
 * Bump ?v= in SHARE_JS (scripts/build_cash_bid_pages.py) on any change here.
 */
(function () {
  'use strict';
  var btn = document.querySelector('[data-share-bid]');
  if (!btn) return;
  var town = location.pathname.replace(/^\/cash-bids\//, '').replace(/\.html$/, '');

  function ga(action, priced) {
    var p = { action: action, town: town, priced: priced ? 'yes' : 'no', crop: btn.getAttribute('data-crop') || '' };
    try {
      if (typeof window.gaEvent === 'function') window.gaEvent('share_bid', p);
      else if (typeof window.gtag === 'function') window.gtag('event', 'share_bid', p);
    } catch (e) {}
  }

  function payload() {
    var until = Date.parse(btn.getAttribute('data-until') || '');
    var priced = !isNaN(until) && Date.now() < until;
    var text = btn.getAttribute(priced ? 'data-text' : 'data-plain') || '';
    var url = btn.href;
    // the copy and the text message carry one link: the tagged one in place of the bare one
    var bare = url.replace(/^https?:\/\/(www\.)?/, '').replace(/^[^/]+/, 'agsist.com').replace(/\?.*$/, '');
    var i = text.lastIndexOf(bare);
    var body = i >= 0 ? text.slice(0, i) + url + text.slice(i + bare.length) : text + ' ' + url;
    // the share sheet adds the tagged url itself: its text drops the bare link so the link shows once
    var sheet = i >= 0 && text.slice(i + bare.length).trim() === '' ? text.slice(0, i).replace(/\s+$/, '') : text;
    return { title: btn.getAttribute('data-title') || document.title, text: text, sheet: sheet, url: url, body: body, priced: priced };
  }

  var more = null, msg = null;
  function say(t) { if (msg) msg.textContent = t; }

  function showInput(body) {
    var box = more.querySelector('input');
    if (!box) {
      box = document.createElement('input');
      box.type = 'text';
      box.readOnly = true;
      box.setAttribute('aria-label', 'Text to share');
      more.insertBefore(box, msg);
    }
    box.value = body;
    try { box.focus(); box.select(); } catch (e) {}
    say('Select and copy.');
  }

  function fallback(p) {
    if (!more) {
      more = document.createElement('span');
      more.className = 'cbt-share-more';
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'cbt-share-btn';
      copy.textContent = 'Copy';
      more.appendChild(copy);
      var phone = false;
      try { phone = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
      if (phone) {
        var sms = document.createElement('a');
        sms.className = 'cbt-share-btn';
        sms.textContent = 'Text it';
        sms.setAttribute('data-share-sms', '');
        more.appendChild(sms);
        sms.addEventListener('click', function () {
          var q = payload();
          sms.href = 'sms:?&body=' + encodeURIComponent(q.body);
          ga('sms', q.priced);
        });
      }
      msg = document.createElement('span');
      msg.className = 'cbt-share-msg';
      msg.setAttribute('role', 'status');
      more.appendChild(msg);
      btn.parentNode.appendChild(more);
      copy.addEventListener('click', function () {
        var q = payload();
        ga('copy', q.priced);
        try {
          navigator.clipboard.writeText(q.body).then(function () { say('Copied.'); }, function () { showInput(q.body); });
        } catch (e) { showInput(q.body); }
      });
    }
    var s = more.querySelector('[data-share-sms]');
    if (s) s.href = 'sms:?&body=' + encodeURIComponent(p.body);
    more.hidden = false;
    say('');
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    var p = payload();
    ga('open', p.priced);
    if (navigator.share) {
      var sent;
      try { sent = navigator.share({ title: p.title, text: p.sheet, url: p.url }); } catch (err) { fallback(p); return; }
      if (sent && sent.then) {
        sent.then(function () { ga('shared', p.priced); }, function (err) {
          if (!err || err.name !== 'AbortError') fallback(p);
        });
      }
      return;
    }
    fallback(p);
  });
})();
