/* components/share-kit.js: the share kit core (Nov 7, 2026, share kit wave 1 step 1). One copy of what every
   shareable picture and printed sheet on AGSIST does the same way: the COT kit (cot-chart.js image(), cot-share.js,
   cot-print.js), Bin Print (bin-yard.js) and County Print (county-print.js) use it, and the next kits start here.

   - THE PICTURE: the dark card and its gold bar (frame), the address and the dated line under it (head), a pen that
     writes, wraps and shrinks text to fit and keeps a record of every word and size it drew (pen: the tests read
     it), and a QR code painted on the card (qr: white square, four modules of quiet zone).
   - THE SHEET: the hidden sheet at the end of <body> (sheet: class sk-sheet, components/share-kit.css hides it on
     screen and makes it the only thing on paper while html.sk-on is set), measuring it off screen (measure), and
     the print hook: any browser print (Ctrl+P, the menu, a phone's Print: beforeprint and matchMedia('print'))
     gives the sheet (printHook), and the Print button's own print (printNow).
   - SHARING: the phone's share sheet with the picture file inside the tap, falling back to a download when the
     share sheet refuses (anything but the reader's own cancel); copy a link with a fallback.
   - ONE LINK CONVENTION: utm_source share|print|email, utm_medium picture|sheet|qr|link, utm_campaign
     <page>-<date> (tags); an arrival tagged by the kit is remembered for the visit, and a QR arrival sends
     qr_visit once (arrival).
   - GA4 names (EV): share_open at each tap, share_done only when the share sheet resolves, picture_download,
     sheet_print at the print itself, qr_visit. GA gets names and counts only, never anything a reader typed.
   Dates: mdy("2026-11-07") "Nov 7, 2026"; dateLine(now) "November 7, 2026" in the Central time the site's day runs
   on; isoDay(now) "2026-11-07" (Central); mdyLocal(date) "Nov 7, 2026" on the device's own clock.
   Exports window.AgShareKit (and module.exports for the tests). */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var FONT = "Inter, 'Inter Fallback', system-ui, sans-serif";
  /* the card's inks: page black, the gold bar, near-white text, the dimmer line */
  var BG = '#0a0c0d', GOLD = '#d4a23f', INK = '#e9edeb', DIM = 'rgba(233,237,235,.82)';
  var EV = { open: 'share_open', done: 'share_done', download: 'picture_download', print: 'sheet_print', qr: 'qr_visit' };
  var SRC = { share: 1, print: 1, email: 1 }, MED = { picture: 1, sheet: 1, qr: 1, link: 1 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mdy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  function mdyLocal(d) { d = d || new Date(); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function isoDay(now) {
    var d = new Date(now == null ? Date.now() : now);
    try { return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).slice(0, 10); } catch (e) { return d.toISOString().slice(0, 10); }
  }
  function dateLine(now) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay(now)); return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1]; }

  /* the kit's tags on a link: ('print', 'qr', 'cot-2026-11-03') -> "utm_source=print&utm_medium=qr&utm_campaign=cot-2026-11-03" */
  function tags(src, med, campaign) { return 'utm_source=' + src + '&utm_medium=' + med + '&utm_campaign=' + campaign; }
  function ga(name, p) { try { if (typeof root.gtag === 'function') root.gtag('event', name, p); } catch (e) {} }

  /* ---------------------------------------------------------------- the picture */
  function canvas(doc, W, H) { var c = (doc || root.document).createElement('canvas'); c.width = W; c.height = H; return c; }
  /* the card: page black with the gold bar across the top, bar px tall */
  function frame(ctx, W, H, bar) { ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); ctx.fillStyle = GOLD; ctx.fillRect(0, 0, W, bar); }
  /* words into lines no wider than max at the context's current font; paras: a newline starts a new line */
  function wrap(ctx, s, max, paras) {
    var out = [];
    (paras ? String(s).split('\n') : [String(s)]).forEach(function (para) {
      var cur = '';
      para.split(' ').forEach(function (w) { var x = cur ? cur + ' ' + w : w; if (ctx.measureText(x).width > max && cur) { out.push(cur); cur = w; } else cur = x; });
      if (cur) out.push(cur);
    });
    return out;
  }
  /* The pen: text(s, x, y, size, weight, ink, align) writes one line and records it (texts, sizes, ys);
     wrap(s, max) at the current font; lines(s, x, y, size, weight, ink, lineHeight, maxLines, width) -> the y
     after; fit(s, size, min, weight, width) -> the largest size (down in steps of 2, not under min) that fits.
     o.paras: wrap starts a new line at each newline. */
  function pen(ctx, o) {
    o = o || {};
    var p = { texts: [], sizes: [], ys: [] };
    function font(size, weight) { ctx.font = weight + ' ' + size + 'px ' + FONT; }
    p.font = font;
    p.text = function (s, x, y, size, weight, ink, al) {
      font(size, weight); ctx.fillStyle = ink; ctx.textAlign = al || 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y);
      p.texts.push(s); p.sizes.push(size); p.ys.push(y);
    };
    p.wrap = function (s, max) { return wrap(ctx, s, max, o.paras); };
    p.lines = function (s, x, y, size, weight, ink, lh, max, width) {
      font(size, weight);
      p.wrap(s, width).slice(0, max).forEach(function (l) { p.text(l, x, y, size, weight, ink); y += lh; });
      return y;
    };
    p.fit = function (s, size, min, weight, width) {
      font(size, weight);
      while (size > min && ctx.measureText(s).width > width) { size -= 2; font(size, weight); }
      return size;
    };
    /* the record of a chart's own words (layout items), for the tests */
    p.keep = function (items) { items.forEach(function (it) { if (it.t === 'text') { p.texts.push(it.s); p.sizes.push(it.size); } }); };
    return p;
  }
  /* the address in gold at the top, then the dated line under it: (pen, 60, 'agsist.com', 'County Print, Nov 7, 2026') */
  function head(p, x, top, sub, o) {
    o = o || {};
    p.text(top, x, 84, o.size || 36, 800, GOLD);
    p.text(sub, x, 132, 28, 600, o.ink || DIM);
  }
  /* a QR matrix m (rows of booleans, no quiet zone) on a white square at x, y, mod px a module; -> its side */
  function qr(ctx, m, x, y, mod) {
    var qs = (m.length + 8) * mod;
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, qs, qs); ctx.fillStyle = '#000';
    m.forEach(function (row, r) { row.forEach(function (v, k) { if (v) ctx.fillRect(x + (k + 4) * mod, y + (r + 4) * mod, mod, mod); }); });
    return qs;
  }

  /* ---------------------------------------------------------------- the sheet */
  /* the sheet element at the end of <body>, made once: id, the kit's own class, and sk-sheet (share-kit.css) */
  function sheet(doc, id, cls) {
    var el = doc.getElementById(id);
    if (!el) { el = doc.createElement('div'); el.id = id; el.className = cls + ' sk-sheet'; el.setAttribute('aria-hidden', 'true'); doc.body.appendChild(el); }
    return el;
  }
  /* fn() run while the sheet is laid out off screen (sk-measure), never seen -> fn's value */
  function measure(el, fn) {
    el.classList.add('sk-measure');
    try { return fn ? fn(el) : el.offsetHeight; } finally { el.classList.remove('sk-measure'); }
  }
  /* print shows the sheet: html.sk-on plus the kit's own class (its CSS keys on it) */
  function show(doc, cls, on) { var h = doc.documentElement.classList; h.toggle('sk-on', !!on); h.toggle(cls, !!on); }
  /* any browser print calls on() before and off() after; o.mq false: beforeprint and afterprint only */
  function printHook(win, on, off, o) {
    win.addEventListener('beforeprint', on);
    win.addEventListener('afterprint', off);
    if (o && o.mq === false) return;
    try {
      var mq = win.matchMedia && win.matchMedia('print'), ch = function (e) { if (e.matches) on(); else off(); };
      if (mq && mq.addEventListener) mq.addEventListener('change', ch); else if (mq && mq.addListener) mq.addListener(ch);
    } catch (e) {}
  }
  function printNow(win, off) { try { win.print(); } catch (e) { off(); } }

  /* ---------------------------------------------------------------- sharing */
  function coarse(win) { try { return !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } }
  function download(doc, blob, name) {
    var a = doc.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function file(blob, name) { try { return new File([blob], name, { type: 'image/png' }); } catch (e) { return null; } }
  /* the phone's share sheet can take this picture file (a touch screen that says so) */
  function canShareFile(win, f) { var n = win.navigator; return !!(f && coarse(win) && n.canShare && n.canShare({ files: [f] })); }
  /* the share sheet; done() when it resolves, fail(err) when it refuses for any reason but the reader's cancel */
  function share(win, data, done, fail) {
    return win.navigator.share(data).then(function () { if (done) done(); }, function (err) {
      if (err && err.name === 'AbortError') return;
      if (fail) fail(err);
    });
  }
  /* the old way to copy, for browsers without the clipboard API: -> true when it copied */
  function execCopy(doc, text) {
    var t = doc.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    doc.body.appendChild(t); t.select();
    var ok = false; try { ok = doc.execCommand('copy'); } catch (e) {}
    doc.body.removeChild(t);
    return ok;
  }
  /* copy text: ok() when it is on the clipboard, else fail() (the kit says what to do instead) */
  function copy(win, text, ok, fail) {
    var c = win.navigator.clipboard;
    if (c && c.writeText) c.writeText(text).then(ok, fail); else fail();
  }
  /* A visit tagged by the kit (utm_source share, print or email): remembered for the visit under key as
     "<source>-<medium>"; a QR arrival sends qr_visit once. -> the tag, or '' */
  function arrival(win, key) {
    var q = null; try { q = new URLSearchParams(win.location.search); } catch (e) {}
    var s = q && q.get('utm_source'), m = q && q.get('utm_medium');
    if (s && SRC[s]) {
      var tag = (s + '-' + String(m || '').replace(/[^a-z]/g, '')).slice(0, 24);
      try { if (sessionStorage.getItem(key) !== tag && m === 'qr') ga(EV.qr, { campaign: q.get('utm_campaign') || '' }); sessionStorage.setItem(key, tag); } catch (e) {}
    }
    try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  var api = { MON: MON, MONTHS: MONTHS, FONT: FONT, BG: BG, GOLD: GOLD, INK: INK, DIM: DIM, EV: EV, SRC: SRC, MED: MED,
    esc: esc, mdy: mdy, mdyLocal: mdyLocal, isoDay: isoDay, dateLine: dateLine, tags: tags, ga: ga,
    canvas: canvas, frame: frame, wrap: wrap, pen: pen, head: head, qr: qr,
    sheet: sheet, measure: measure, show: show, printHook: printHook, printNow: printNow,
    coarse: coarse, download: download, file: file, canShareFile: canShareFile, share: share, execCopy: execCopy, copy: copy, arrival: arrival };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgShareKit = api;
})(typeof window !== 'undefined' ? window : this);
