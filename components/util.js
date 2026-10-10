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

  /* ── Grain prices: the one formatter (2026-10-10) ──────────────────────
     One corn close of 480.5 cents printed as $4.80, $4.80 1/2 and $4.81 on
     different parts of the site, because nine separate formatters rounded
     it nine ways (toFixed(2) on dollars rounds the half cent away; some
     rounded to the quarter, some to the cent). Every grain price, change
     and 52-week range end now comes through here.

     Rules:
       - Grains trade in quarter cents. A price prints to the quarter.
       - Rounding happens once, on quarter-cents, with a float guard, so
         480.49999999 (float noise for 480.5) is a half, not a whole.
       - A 52-week range end is never rounded inward: the low rounds DOWN
         and the high rounds UP to the quarter. A tick that traded on the
         exact quarter prints exactly.
       - Two looks, same number: 'glyph' ($4.80½) for prices in prose and
         big type, 'slash' ($4.80 1/2) where the mono font makes ¾ read
         like % (the ticker; see geo.js note of 2026-09-30).
       - A minus is a true minus (U+2212); zero has no sign.
     Inputs are CENTS per bushel unless the name says dollars. */
  var GLYPH = ['', '¼', '½', '¾'];
  var SLASH = ['', '1/4', '1/2', '3/4'];
  var MINUS = '−';

  /* Quarter-cent count for |c|. mode: 'down' floors, 'up' ceils, else nearest.
     The direction applies to the SIGNED value, so a range low of -3.1 goes
     to -3.25 (down), not -3.0. */
  function quarters(c, mode) {
    var x = Number(c) * 4;
    var r = Math.round(x * 1e6) / 1e6; // strip float noise before deciding
    if (mode === 'down') r = Math.floor(r);
    else if (mode === 'up') r = Math.ceil(r);
    else r = r < 0 ? -Math.round(-r) : Math.round(r);
    return r;
  }
  function parts(c, mode) {
    var q = quarters(c, mode), a = Math.abs(q);
    return { neg: q < 0, whole: Math.floor(a / 4), frac: a % 4, q: q };
  }
  function ok(v) { return v != null && v !== '' && isFinite(Number(v)); }
  function fracText(f, o) {
    if (!f) return '';
    var slash = o && o.style === 'slash';
    var t = slash ? ' ' + SLASH[f] : GLYPH[f];
    return (o && o.fracClass) ? '<span class="' + o.fracClass + '">' + t + '</span>' : t;
  }

  /* 480.5 -> "$4.80½" (or "$4.80 1/2" with {style:'slash'}).
     opts: style 'glyph'|'slash', mode 'near'|'down'|'up',
           fracClass (wraps the fraction in a span: returns HTML),
           dollar false (no "$"). Missing value -> ''. */
  function price(c, o) {
    if (!ok(c)) return '';
    o = o || {};
    var p = parts(c, o.mode);
    var d = Math.floor(p.whole / 100), cc = p.whole % 100;
    return (p.neg ? MINUS : '') + (o.dollar === false ? '' : '$') + d + '.' + (cc < 10 ? '0' : '') + cc + fracText(p.frac, o);
  }
  function priceDollars(d, o) { return ok(d) ? price(Number(d) * 100, o) : ''; }

  /* A move in cents, unsigned: 19.75 -> "19¾¢"; 0.25 -> "¼¢"; 0 -> "0¢".
     opts: style, sign (true prefixes + or −), cent (false drops the ¢). */
  function move(c, o) {
    if (!ok(c)) return '';
    o = o || {};
    var p = parts(c, o.mode);
    var fr = p.frac ? (o.style === 'slash' ? SLASH[p.frac] : GLYPH[p.frac]) : '';
    var body = (p.whole || !fr ? String(p.whole) : '') + (p.whole && fr && o.style === 'slash' ? ' ' : '') + fr;
    var sg = o.sign ? (p.q > 0 ? '+' : p.q < 0 ? MINUS : '') : '';
    return sg + body + (o.cent === false ? '' : '¢');
  }

  /* Percent change, signed: -3.951 -> "−3.95%". opts.dp (default 2). */
  function pct(p, o) {
    if (!ok(p)) return '';
    var dp = o && o.dp != null ? o.dp : 2;
    var n = Number(p), t = Math.abs(n).toFixed(dp);
    var zero = Number(t) === 0;
    return (zero ? '' : (n > 0 ? '+' : MINUS)) + t + '%';
  }

  /* Day change for a grain: {t:"▼ −19¾¢ (−3.95%)", c:"dn"}.
     opts: style, dp, sep (between cents and percent; default " (" ... ")"),
           arrow (false drops the triangle). */
  function change(net, pc, o) {
    if (!ok(net)) return { t: '', c: 'nc' };
    o = o || {};
    var q = quarters(net);
    if (q === 0) return { t: 'unch', c: 'nc' };
    var ar = o.arrow === false ? '' : (q > 0 ? '▲ ' : '▼ ');
    var mv = move(net, { style: o.style, sign: true });
    var pt = ok(pc) ? pct(pc, o) : '';
    var tail = pt ? (o.sep != null ? o.sep + pt : ' (' + pt + ')') : '';
    return { t: ar + mv + tail, c: q > 0 ? 'up' : 'dn' };
  }

  /* 52-week ends, never rounded inward. Returns {lo, hi} strings. */
  function range(lo, hi, o) {
    o = o || {};
    var a = {}, k;
    for (k in o) a[k] = o[k];
    a.mode = 'down'; var l = price(lo, a);
    a.mode = 'up'; var h = price(hi, a);
    return { lo: l, hi: h };
  }

  var px = { quarters: quarters, parts: parts, price: price, priceDollars: priceDollars,
             move: move, pct: pct, change: change, range: range, MINUS: MINUS };

  if (typeof w.esc !== 'function') w.esc = esc;
  if (typeof w.el !== 'function') w.el = el;
  if (typeof w.gaEvent !== 'function') w.gaEvent = gaEvent;
  w.AG = w.AG || {};
  w.AG.esc = esc; w.AG.el = el; w.AG.gaEvent = gaEvent; w.AG.px = px;
})(window);
