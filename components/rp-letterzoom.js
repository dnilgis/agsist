/* components/rp-letterzoom.js: read a sample box letter full size (fx/letterzoom, 2026-10-31, Sig).
 *
 * One shared bit of code for every page that shows a sample letter (/rain-print "What's in the box" and
 * /rain-print-business). The page holds a <button class="lz-btn" data-lz="/img/..-lg.webp" data-lz-alt="...">
 * around the small picture, with its cue text. Pressing it opens a <dialog> with the large copy
 * (1700 px wide, made by scripts/render_rp_letter_large.mjs). The large file is not named anywhere a
 * browser fetches until the dialog is first opened, so the page weight does not change. Close with the
 * button, Esc or a click outside; focus goes back to the button that opened it. On a phone the picture is
 * wider than the screen: it scrolls both ways and pinch-zoom works.
 *
 * The dialog is built on first press and adds nothing to the page layout (it is a top-layer element).
 * Without <dialog> support the large picture opens in a new tab.
 */
(function () {
  'use strict';
  var dlg = null, img = null, opener = null;
  var CSS = '.lz-dlg{padding:0;border:1px solid var(--border,#ccc);border-radius:8px;background:#fff;color:#111;width:min(1100px,96vw);max-width:96vw;max-height:94vh;overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y pinch-zoom}' +
    '.lz-dlg::backdrop{background:rgba(0,0,0,.72)}' +
    '.lz-bar{position:sticky;top:0;left:0;display:flex;justify-content:flex-end;height:0;z-index:2}' +
    '.lz-x{position:sticky;right:8px;margin:8px 8px 0 0;min-width:48px;min-height:48px;padding:0 14px;border:1px solid #333;border-radius:24px;background:#fff;color:#111;font:600 15px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)}' +
    '.lz-x:focus-visible{outline:3px solid #b8860b;outline-offset:2px}' +
    '.lz-img{display:block;width:max(100%,820px);max-width:1700px;height:auto;margin:0}';
  function build() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    dlg = document.createElement('dialog'); dlg.className = 'lz-dlg'; dlg.setAttribute('aria-label', 'Sample letter, full size');
    var bar = document.createElement('div'); bar.className = 'lz-bar';
    var x = document.createElement('button'); x.type = 'button'; x.className = 'lz-x'; x.textContent = 'Close'; x.setAttribute('aria-label', 'Close the full size letter');
    bar.appendChild(x);
    img = document.createElement('img'); img.className = 'lz-img'; img.decoding = 'async';
    dlg.appendChild(bar); dlg.appendChild(img); document.body.appendChild(dlg);
    x.addEventListener('click', function () { dlg.close(); });
    // a click on the backdrop lands on the dialog itself; the picture and the button fill it otherwise
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () {
      if (opener && opener.focus) { try { opener.focus(); } catch (e) { } }
      opener = null;
    });
  }
  function open(btn) {
    var src = btn.getAttribute('data-lz'); if (!src) return;
    if (typeof HTMLDialogElement === 'undefined') { window.open(src, '_blank', 'noopener'); return; }
    if (!dlg) build();
    opener = btn;
    img.alt = btn.getAttribute('data-lz-alt') || 'The sample letter, full size';
    if (img.getAttribute('src') !== src) img.src = src;
    dlg.showModal();
    dlg.scrollTop = 0; dlg.scrollLeft = 0;
  }
  function init() {
    var bs = document.querySelectorAll('button.lz-btn[data-lz]');
    for (var i = 0; i < bs.length; i++) bs[i].addEventListener('click', function () { open(this); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
