/* components/print-qr.js: the QR code on a printed report (Oct 19, 2026).
   Sig: every printed report carries a QR that opens the same report on the site.
   It draws with components/qr.js (window.AgQR, the one QR encoder on the site)
   and is used by /comp-report, /field-report and the /hail-map Hail History
   Report. The code holds the report's full link, every setting in it.

   Size: about 0.85 in. A link with a long field outline needs a bigger code
   version; at 0.85 in its squares would get too small for a phone, so the code
   grows to keep each square at least 0.01 in (0.25 mm). Version 15 (77 squares,
   412 letters at level M) is the largest that fits 0.85 in. Past version 25
   (117 squares, 1.25 in, 997 letters) no code is printed: the line says to use
   the address instead. There is no general short link on the site (the /R one
   is Rain Print's own).

     AgPrintQR.plan(url)  -> {ver, inches} or null when the link is too long
     AgPrintQR.html(url, shown, opts) -> '<div class="agpq" data-qr="url">...'
       shown: the short address printed under the code (agsist.com/comp-report).
       opts.screen: true shows it on screen too (the hail report's own window,
       which is the printout). Otherwise it shows in print only.  */
(function (w) {
  'use strict';
  if (w.AgPrintQR) return;
  var MIN_IN = 0.85, SQUARE_IN = 0.01, MAX_VER = 25;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plan(url) {
    if (!w.AgQR) return null;
    var m;
    try { m = w.AgQR.matrix(url, null, null, MAX_VER); } catch (e) { return null; }
    var n = m.length + 8;   // four light squares of margin on each side
    return { ver: (m.length - 17) / 4, inches: Math.max(MIN_IN, Math.ceil(n * SQUARE_IN * 100) / 100) };
  }
  var CSS = '.agpq{display:none;float:none;width:1.35in;text-align:center;font:6.5pt/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;color:#222;break-inside:avoid}' +
    '.agpq svg{display:block;margin:0 auto 2pt}.agpq p{margin:0!important;font-size:6.5pt!important;color:#222!important;line-height:1.25!important}.agpq .agpq-u{font-family:ui-monospace,Menlo,Consolas,monospace;color:#444!important;overflow-wrap:anywhere}' +
    '@media print{.agpq{display:block}}.agpq.agpq-scr{display:block}';
  function addCSS(doc) {
    doc = doc || w.document;
    if (!doc || doc.getElementById('agpq-css')) return;
    var s = doc.createElement('style'); s.id = 'agpq-css'; s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }
  function html(url, shown, opts) {
    opts = opts || {};
    var p = plan(url), cls = 'agpq' + (opts.screen ? ' agpq-scr' : '');
    if (!p) return '<div class="' + cls + '" data-qr=""><p><b>Open this report on agsist.com</b></p><p class="agpq-u">' + esc(shown) + '</p><p>(the full link is too long for a code)</p></div>';
    var svg = w.AgQR.svg(url, 'QR code that opens this report on agsist.com', MAX_VER)
      .replace('<svg ', '<svg style="width:' + p.inches + 'in;height:' + p.inches + 'in" ');
    return '<div class="' + cls + '" data-qr="' + esc(url) + '" data-ver="' + p.ver + '"' + (p.inches > 1.2 ? ' style="width:' + (p.inches + 0.1).toFixed(2) + 'in"' : '') + '>' + svg +
      '<p>Scan to open this report on agsist.com</p><p class="agpq-u">' + esc(shown) + '</p></div>';
  }
  w.AgPrintQR = { plan: plan, html: html, addCSS: addCSS, CSS: CSS, MIN_IN: MIN_IN, MAX_VER: MAX_VER };
})(typeof window !== 'undefined' ? window : this);
