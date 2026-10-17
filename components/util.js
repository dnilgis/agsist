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

  /* A CASH BID AS THE ELEVATOR POSTED IT, in dollars: 4.2125 -> "$4.2125",
     12.475 -> "$12.475", 4.2 -> "$4.20". Two decimals, more only when the
     board wrote more, never more than four. toFixed(2) rounded 12.475 to
     "12.47" (the binary value is 12.47499...) and cut ADM's 4.2125 to 4.21.
     opts: dollar false (no "$"). Twin: scripts/pricefmt.py cash(). */
  function cash(v, o) {
    if (!ok(v)) return '';
    var n = Number(v), r = Math.round(Math.abs(n) * 10000) / 10000;
    var s = r.toFixed(4).replace(/0+$/, '');
    if (s.length - s.indexOf('.') - 1 < 2) s = r.toFixed(2);
    return (n < 0 && r ? MINUS : '') + (o && o.dollar === false ? '' : '$') + s;
  }

  /* Basis in signed cents with a true minus: -65 -> "−65¢", 12.5 -> "+12½¢",
     0 -> "even". A quarter-cent basis prints its glyph; anything finer prints
     as posted, to two places ("−12.3¢"). opts.contract appends the month:
     basis(-65, {contract:"Dec '26"}) -> "−65¢ Dec '26". Input is CENTS.
     Twin: scripts/pricefmt.py basis(). */
  function basis(c, o) {
    if (!ok(c)) return '';
    o = o || {};
    var n = Number(c), a = Math.round(Math.abs(n) * 100) / 100, body;
    if (a === 0) body = 'even';
    else {
      var q = Math.round(a * 4 * 1e6) / 1e6;
      if (q === Math.floor(q)) {
        var w = Math.floor(q / 4), f = q % 4;
        body = (w || !f ? String(w) : '') + GLYPH[f];
      } else body = String(a);
      body = (n > 0 ? '+' : MINUS) + body + '¢';
    }
    return body + (o.contract ? ' ' + o.contract : '');
  }

  /* One label for a futures contract: "Dec '26". Reads "Dec 2026",
     "December 2026", "Dec26", "Dec 26", "Dec ’26" and tickers (ZCZ26, ZCZ6).
     Anything after the year ("Dec 26 KCBT Red Wheat") is kept; text that is
     not a month is returned as written. Twin: scripts/pricefmt.py contract(). */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CODE = 'FGHJKMNQUVXZ';
  function contract(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    /* a month name first: "Nov26" is November, not the ticker N-O-V26 */
    var m = /^([A-Za-z]{3})[A-Za-z]*\.?\s*['’]?(\d{4}|\d{2})(?!\d)\s*(.*)$/.exec(t);
    var i = m ? MON.map(function (x) { return x.toLowerCase(); }).indexOf(m[1].toLowerCase()) : -1;
    if (i >= 0) return MON[i] + " '" + m[2].slice(-2) + (m[3] ? ' ' + m[3] : '');
    var k = /^[A-Z]{1,3}([FGHJKMNQUVXZ])(\d{1,2})$/.exec(t.toUpperCase());
    if (k) return MON[CODE.indexOf(k[1])] + " '" + (k[2].length === 1 ? '2' + k[2] : k[2]);
    return t;
  }

  var px = { quarters: quarters, parts: parts, price: price, priceDollars: priceDollars,
             move: move, pct: pct, change: change, range: range, cash: cash, basis: basis,
             contract: contract, MINUS: MINUS };

  /* Fetch once per page. Measured 2026-10-12: the homepage asked for
     prices.json four times and six other files twice each, because every page
     script fetched its own copy. AG.json(url) starts one request per URL for
     the life of the page and hands each caller its OWN parsed copy (the text
     is shared, the object is not), so one script editing what it got cannot
     change what another script sees. It rejects on a network error, a non-2xx
     status or bad JSON, like a fetch that checks r.ok; a failure is not kept,
     so a later call tries again. cache:'no-cache' revalidates with the server
     every time the page loads, so the copy is never older than a fresh fetch.
     Not for polling: a refresh that must see a newer file calls fetch(). */
  /* A DEADLINE (2026-10-17, chaos-4). A request that never answers left
     skeletons and "Loading..." up for good, because nothing here ever
     rejected, so a page's own "did not load, try again" never showed. Past
     TIMEOUT_MS the request is aborted (where AbortController exists) and the
     promise rejects either way, headers and body together. */
  var TIMEOUT_MS = 15000;
  function timed(url, opts, ms) {
    ms = ms || TIMEOUT_MS;
    var ctl = null, timer = null;
    try { if (typeof AbortController === 'function') ctl = new AbortController(); } catch (e) { ctl = null; }
    var o = {}; for (var k in (opts || {})) o[k] = opts[k];
    if (ctl && !o.signal) o.signal = ctl.signal;
    var dead = new Promise(function (res, rej) {
      timer = setTimeout(function () { if (ctl) { try { ctl.abort(); } catch (e) {} } rej(new Error(url + ' timeout')); }, ms);
    });
    return { dead: dead, ctl: ctl, done: function () { clearTimeout(timer); }, p: fetch(url, o) };
  }
  /* fetch() with the deadline, for pages that read a file themselves:
     AG.fetch(url, opts, ms) -> resolves with the Response, rejects past ms. */
  function tfetch(url, opts, ms) {
    var t = timed(String(url), opts, ms);
    return Promise.race([t.p, t.dead]).then(function (r) { t.done(); return r; }, function (e) { t.done(); throw e; });
  }
  var ONCE = {};
  function text(url) {
    var k = String(url);
    if (!ONCE[k]) {
      var t = timed(k, { cache: 'no-cache' });
      var p = Promise.race([t.p.then(function (r) {
        if (!r.ok) throw new Error(k + ' ' + r.status);
        return r.text();
      }), t.dead]);
      p.then(t.done, t.done);
      ONCE[k] = p;
      p.catch(function () { if (ONCE[k] === p) delete ONCE[k]; });
    }
    return ONCE[k];
  }
  function json(url) { return text(url).then(function (t) { return JSON.parse(t); }); }

  if (typeof w.esc !== 'function') w.esc = esc;
  if (typeof w.el !== 'function') w.el = el;
  if (typeof w.gaEvent !== 'function') w.gaEvent = gaEvent;
  w.AG = w.AG || {};
  w.AG.esc = esc; w.AG.el = el; w.AG.gaEvent = gaEvent; w.AG.px = px;
  w.AG.json = json; w.AG.text = text; w.AG.fetch = tfetch; w.AG.TIMEOUT_MS = TIMEOUT_MS;
})(window);
