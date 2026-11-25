/* The open sitewide sponsor strip (Nov 19, 2026: the site's reader figures are shown on /sponsor only).
 * components/loader.js loads this only when the sitewide spot is unsold, into the line it already holds the room for
 * (styles.css --sw-h), so nothing moves. One plain labeled line that says the spot is open and where to see who
 * reads AGSIST and the prices, and one button to /sponsor. No figure and no price on any reader page. Flat colors,
 * no gradient.
 */
(function (root) {
  'use strict';
  /* Radii use the site tokens (--r-sm). Widths: above 1000 px one line in the 36 px the header holds; at 1000 px and
     under two lines in 54 px; at 540 px and under the button reads "Advertise here". Never cut with an ellipsis.
     Measured clean from 320 to 1440 px. */
  var CSS = '.sw-in.sw-open{display:flex;align-items:center;gap:10px;padding:3px 4px 3px 10px;border:1px solid rgba(var(--ad-orange-rgb),.55);border-radius:var(--r-sm,4px);background:rgba(var(--ad-orange-rgb),.08);color:var(--text-dim);font-size:.8rem;line-height:1.3}' +
    '.sw-pitch{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap}' +
    '.sw-hook{font-weight:700;color:var(--text)}' +
    '.sw-in.sw-open a.sw-cta{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-height:0;padding:1px 12px;border-radius:var(--r-sm,4px);background:var(--ad-orange);color:#1a0d05;text-decoration:none;font-weight:700;white-space:nowrap}' +
    '.sw-in.sw-open a.sw-cta:hover,.sw-in.sw-open a.sw-cta:focus-visible{background:var(--ad-orange-hi);color:#1a0d05}' +
    'html[data-theme="light"] .sw-in.sw-open a.sw-cta{background:var(--ad-orange-ink);color:#fff}' +
    'html[data-theme="light"] .sw-in.sw-open a.sw-cta:hover,html[data-theme="light"] .sw-in.sw-open a.sw-cta:focus-visible{background:#8a2e08;color:#fff}' +
    '.sw-cs{display:none}' +
    '@media (max-width:1000px){.sw-in.sw-open{font-size:.78rem;gap:8px}.sw-pitch{white-space:normal}.sw-in.sw-open a.sw-cta{min-height:0;padding:2px 8px;white-space:normal;width:8.8em;align-self:center;text-align:center;line-height:1.15;font-size:.76rem}}' +
    '@media (max-width:540px){.sw-in.sw-open{gap:6px;padding-left:8px}.sw-in.sw-open a.sw-cta{width:6.4em;padding:2px 5px;overflow-wrap:normal;word-break:normal;hyphens:none}.sw-cl{display:none}.sw-cs{display:inline}}';

  /* "Sponsor spot open. See who reads AGSIST and the prices." and the button. The spots file is not read: the figures
     live on /sponsor. */
  function html(spots, base) {
    var to = (base || '') + '/sponsor#sitewide';
    return '<span class="sw-in sw-open"><span class="sw-pitch">' +
      '<span class="sw-hook">Sponsor spot open.</span> See who reads AGSIST and the prices.</span>' +
      '<a class="sw-cta" href="' + to + '" onclick="if(typeof gtag===\'function\')gtag(\'event\',\'sponsor_cta_click\',{cta_source:\'sitewide_open\'})">' +
      '<span class="sw-cl">Put your business here</span><span class="sw-cs">Advertise here</span></a></span>';
  }

  var api = { html: html, CSS: CSS };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  var doc = root.document;
  if (doc && !doc.getElementById('sw-open-css')) {
    var st = doc.createElement('style'); st.id = 'sw-open-css'; st.textContent = CSS; doc.head.appendChild(st);
  }
  root.AgsistSwOpen = api;
})(typeof window !== 'undefined' ? window : this);
