/* components/print-sheet.js (+ print-sheet.css): the one printed format for every table, calculator and result on AGSIST, modelled on the ARC or PLC counter sheet.
   AgPrintSheet.print(spec) prints it now, .attach(() => spec) makes Ctrl+P print it too, .html(spec) returns it; spec = {kicker, title, sub, intro, sections:[{h, rows:[{label,value,note,date,src}]} | {h, table:{head,rows}} | {h, html}], sources:[{name,date}], url, qr, shown, foot, page}.

   What every sheet carries, whatever the page:
     header   kicker (what it is), the title (the place or the subject) large, one sub line,
              AGSIST at the right, a heavy rule
     body     the sections the page hands over, in order; a row never splits across pages
     sources  one line per source actually printed, each with its date (the page builds the
              list from the rows it printed)
     bottom   the foot line on the left; on the right the QR code to the live page (the
              smallest code that holds spec.qr, else spec.url) with the short address under it
     footer   "Prepared by AGSIST (agsist.com), printed <date>", and on every page the
              running title and "Page n of N"
   Black on white in every theme, Letter, 0.45 in margins. On screen the sheet is not shown; the
   page keeps its own layout. Links, buttons and "did not answer" notes never reach paper: the
   page passes plain words. The sheet is rebuilt for every print, so it is never stale. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.AgPrintSheet = factory(root);
})(typeof self !== 'undefined' ? self : this, function (w) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CSS = '/components/print-sheet.css?v=1';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() {
    var d = new Date(), p = null;
    try { p = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { p = null; }
    return p || MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function qrSvg(text, label) {
    var Q = w && w.AgQR;
    if (!Q || !text) return '';
    try { return Q.svg(text, label || 'QR code for the live page', 10, 'mixed'); } catch (e) { return ''; }
  }
  function rows(list) {
    return '<table class="agps-rows"><tbody>' + list.map(function (r) {
      var meta = [r.date, r.src].filter(Boolean).map(esc).join(' &middot; ');
      return '<tr><th scope="row">' + esc(r.label) + '</th><td><span class="agps-v">' + esc(r.value) + '</span>' +
        (r.note ? '<span class="agps-n">' + esc(r.note) + '</span>' : '') + '</td><td class="agps-m">' + meta + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function table(t) {
    return '<table class="agps-table"><thead><tr>' + (t.head || []).map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (t.rows || []).map(function (r) { return '<tr>' + r.map(function (c, i) { return i ? '<td>' + esc(c) + '</td>' : '<th scope="row">' + esc(c) + '</th>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  function section(s) {
    var body = s.rows ? rows(s.rows) : s.table ? table(s.table) : s.html || '';
    if (!body) return '';
    return '<section class="agps-sec' + (s.cls ? ' ' + esc(s.cls) : '') + '">' + (s.h ? '<h2>' + esc(s.h) + '</h2>' : '') + body + (s.note ? '<p class="agps-note">' + esc(s.note) + '</p>' : '') + '</section>';
  }
  function html(spec) {
    spec = spec || {};
    var printed = spec.printed || today(), url = spec.url || '', code = spec.qr || url;
    var shown = spec.shown || url.replace(/^https?:\/\//i, '').replace(/^AGSIST\.COM/, 'agsist.com');
    var qr = qrSvg(code, 'QR code for ' + shown);
    var srcs = (spec.sources || []).filter(function (s) { return s && s.name; });
    return '<div class="agps-in">' +
      '<header class="agps-top"><div><p class="agps-kick">' + esc(spec.kicker || '') + '</p><h1 class="agps-title">' + esc(spec.title || '') + '</h1>' +
      (spec.sub ? '<p class="agps-sub">' + esc(spec.sub) + '</p>' : '') + '</div><p class="agps-brand">AGSIST</p></header>' +
      (spec.intro ? '<p class="agps-intro">' + esc(spec.intro) + '</p>' : '') +
      (spec.sections || []).map(section).join('') +
      (srcs.length ? '<section class="agps-sec agps-srcs"><h2>Sources</h2><ul>' + srcs.map(function (s) { return '<li><b>' + esc(s.name) + '</b>' + (s.date ? ', ' + esc(s.date) : '') + '</li>'; }).join('') + '</ul></section>' : '') +
      '<div class="agps-bottom"><p class="agps-foot">' + esc(spec.foot || 'For information, not financial advice. Each number carries its source and date.') + '</p>' +
      (qr ? '<div class="agps-qr"><p class="agps-scan">Scan for the live page</p>' + qr + '<p class="agps-url">' + esc(shown) + '</p></div>' : '<p class="agps-url">' + esc(shown) + '</p>') + '</div>' +
      '<p class="agps-prep"><b>Prepared by AGSIST (agsist.com), printed ' + esc(printed) + '</b></p></div>';
  }
  function ensureCss(d) {
    if (d.getElementById('agps-css') || d.querySelector('link[href^="/components/print-sheet.css"]')) return;
    var l = d.createElement('link'); l.id = 'agps-css'; l.rel = 'stylesheet'; l.href = CSS; d.head.appendChild(l);
  }
  /* Put the sheet in the page (hidden on screen) and switch print to it. */
  function mount(spec) {
    var d = w.document;
    if (!d || !d.body) return null;
    ensureCss(d);
    var el = d.getElementById('agps');
    if (!el) { el = d.createElement('div'); el.id = 'agps'; el.className = 'agps'; el.setAttribute('aria-hidden', 'true'); d.body.appendChild(el); }
    el.innerHTML = html(spec);
    var run = d.getElementById('agps-page');
    if (!run) { run = d.createElement('style'); run.id = 'agps-page'; d.head.appendChild(run); }
    var title = String(spec.page || spec.title || '').replace(/["\\\n]/g, '');
    run.textContent = '@media print{@page{size:letter;margin:.45in .45in .55in;@bottom-left{content:"AGSIST \\00B7  ' + title + '";font:8pt/1 system-ui,sans-serif;color:#444}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt/1 system-ui,sans-serif;color:#444}}}';
    d.documentElement.classList.add('agps-on');
    return el;
  }
  function unmount() {
    var d = w.document;
    if (d) d.documentElement.classList.remove('agps-on');
  }
  var builder = null, wired = false, held = null;
  /* fn() -> spec, or null when the page has nothing to print yet (then the browser prints the page). */
  function attach(fn) {
    builder = fn;
    if (wired || !w.addEventListener) return;
    wired = true;
    w.addEventListener('beforeprint', function () { var s = held; if (!s) { try { s = builder && builder(); } catch (e) { s = null; } } if (s) mount(s); });
    w.addEventListener('afterprint', function () { held = null; unmount(); });
  }
  /* Print now. The sheet stays switched on through the dialog; afterprint switches it off. */
  function print(spec) {
    if (!mount(spec)) return false;
    held = spec;
    if (!wired) attach(builder);
    try { w.print(); } catch (e) { return false; }
    return true;
  }
  return { html: html, mount: mount, unmount: unmount, attach: attach, print: print, esc: esc };
});
