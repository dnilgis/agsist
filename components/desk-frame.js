/* A desk tab page (desk/*.html) shown inside /desk (Sig, Oct 28: "one admin home").
   Inside the desk it hides its own token box and heading (the desk has the one
   token box, under the same browser key), and its links open in the desk window,
   not inside the frame. Opened on its own, it does nothing and the page works
   exactly as before. */
(function () {
  try { if (window.top === window) return; } catch (e) { return; }
  var d = document.documentElement;
  d.classList.add('in-desk');
  var s = document.createElement('style');
  s.textContent = 'html.in-desk [data-desk-tok],html.in-desk main>h1,html.in-desk .td>h1{display:none!important}';
  document.head.appendChild(s);
  var b = document.createElement('base');
  b.target = '_top';
  document.head.appendChild(b);
})();
