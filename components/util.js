/* ══════════════════════════════════════════════════════════════════════════
   AGSIST shared helpers

   Measured 2026-09-13: 1,516 KB of inline JavaScript across 65 pages, with the
   same small helpers declared over and over -- esc() 17 times, gaEvent() 22,
   el() 6. That is not mainly a byte problem. It is a correctness problem:

     - esc() existed in TWO behaviours. One escaped & < > and stopped there.
       fertilizer.html and conditions-yield.html build HTML ATTRIBUTES with it
       (`="'+esc(...)`), so an elevator called  Sam's 12" Co-op  closes the
       attribute early:  <a title="Sam's 12" Co-op">
     - That same variant is String(s || ''), so esc(0) returns '' -- a zero
       renders as nothing on a site whose first rule is never to invent or lose
       a number.
     - whats-priced-in.html declared esc() twice, in two IIFEs. On 2026-09-11 a
       block that called the one it could not see threw a ReferenceError inside
       a fetch .catch and silently blanked the flagship panel. Seventeen copies
       is seventeen chances at that.

   Loaded BEFORE any page script and not deferred, so it is there whenever a
   page's own code runs. A page that still declares its own copy shadows these
   inside its own scope and behaves exactly as it did -- nothing here can break
   a page that has not been migrated.
   ══════════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';

  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  /* Escapes exactly what the careful copies on this site already escaped --
     & < > and the double quote -- so text renders byte-for-byte as before and
     a double-quoted attribute can no longer be closed by its own content. null
     and undefined become '', but 0 and false become "0" and "false": losing a
     zero is a wrong number, not a blank. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ENT[c]; });
  }

  function el(id) { return document.getElementById(id); }

  /* Analytics must never be the reason a page throws. */
  function gaEvent(n, p) {
    try { if (typeof w.gtag === 'function') w.gtag('event', n, p || {}); } catch (e) {}
  }

  if (typeof w.esc !== 'function') w.esc = esc;
  if (typeof w.el !== 'function') w.el = el;
  if (typeof w.gaEvent !== 'function') w.gaEvent = gaEvent;
  w.AG = w.AG || {};
  w.AG.esc = esc; w.AG.el = el; w.AG.gaEvent = gaEvent;
})(window);
