/* The open sitewide sponsor strip sells itself (Sig, Nov 13, 2026). components/loader.js loads this only when the
 * sitewide spot is unsold, into the line it already holds the room for (styles.css --sw-h), so nothing moves.
 * It says what is for sale and prints the week's proof numbers from data/sponsor-spots.json (scripts/bake_audience.py:
 * engaged visits and Bing AI answer citations over 30 days, each source's own dates in the title) and one button to
 * /sponsor. No price here: the price is on /sponsor. Flat colors, no gradient.
 * A figure the file does not hold is left out, never made up.
 */
(function (root) {
  'use strict';
  /* Radii use the site tokens (--r-sm), so the plain-look radii carry through. Widths: above 960 px one line in the 36 px the
     header holds; at 960 px and under two lines in 54 px; at 540 px and under the Bing figure and the second half of the
     hook go. Nothing is cut with an ellipsis: what does not fit is left out whole. */
  var CSS = '.sw-in.sw-open{display:flex;align-items:center;gap:10px;padding:3px 4px 3px 10px;border:1px solid rgba(var(--ad-orange-rgb),.55);border-radius:var(--r-sm,4px);background:rgba(var(--ad-orange-rgb),.08);color:var(--text-dim);font-size:.8rem;line-height:1.3}' +
    '.sw-pitch{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap}' +
    '.sw-hook{font-weight:700;color:var(--text)}.sw-pitch b{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}' +
    '.sw-in.sw-open a.sw-cta{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-height:0;padding:1px 12px;border-radius:var(--r-sm,4px);background:var(--ad-orange);color:#1a0d05;text-decoration:none;font-weight:700;white-space:nowrap}' +
    '.sw-in.sw-open a.sw-cta:hover,.sw-in.sw-open a.sw-cta:focus-visible{background:var(--ad-orange-hi);color:#1a0d05}' +
    'html[data-theme="light"] .sw-in.sw-open a.sw-cta{background:var(--ad-orange-ink);color:#fff}' +
    'html[data-theme="light"] .sw-in.sw-open a.sw-cta:hover,html[data-theme="light"] .sw-in.sw-open a.sw-cta:focus-visible{background:#8a2e08;color:#fff}' +
    '.sw-s,.sw-br{display:none}' +
    '@media (max-width:1180px){.sw-what-l{display:none}}' +
    '@media (max-width:960px){.sw-in.sw-open{font-size:.78rem;gap:8px}.sw-pitch{white-space:normal}.sw-br{display:block}.sw-l{display:none}.sw-s{display:inline}' +
    '.sw-in.sw-open a.sw-cta{min-height:0;padding:2px 8px;white-space:normal;width:8.8em;align-self:center;text-align:center;line-height:1.15;font-size:.76rem}}' +
    '@media (max-width:540px){.sw-ai,.sw-what{display:none}}';

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(x) { return typeof x === 'number' && x > 0 ? x.toLocaleString('en-US') : ''; }
  function win(o) { return o && o.start && o.end ? o.start + ' to ' + o.end : ''; }
  function lab(l, sh) { return '<span class="sw-l">' + l + '</span><span class="sw-s">' + sh + '</span>'; }

  /* "Sponsor spot open: one business, one line on every page." then the strongest numbers a buyer can use (engaged visits
     first, then Bing AI citations, named as Bing's), each over 30 days, then the button. The list count is on /sponsor and
     the state card; it is not the line a buyer should end on. */
  function html(spots, base) {
    var pr = (spots && spots.proof) || {}, bits = [], tip = [];
    if (num(pr.engaged && pr.engaged.total)) {
      bits.push('<span class="sw-eng"><b>' + num(pr.engaged.total) + '</b> ' + lab('engaged visits', 'visits') + '</span>');
      tip.push('Engaged visits ' + win(pr.engaged) + ', Google Analytics');
    }
    if (num(pr.ai && pr.ai.total)) {
      bits.push('<span class="sw-ai"><span class="sw-l"> and </span><span class="sw-s"> &middot; </span><b>' + num(pr.ai.total) + '</b> Bing AI citations</span>');
      tip.push('Bing AI answer citations ' + win(pr.ai) + ', Bing Webmaster');
    }
    var nums = bits.length ? bits.join('') + ' ' + lab('in the last 30 days.', '(30 days)') : '';
    return '<span class="sw-in sw-open"' + (tip.length ? ' title="' + esc(tip.join('. ') + '.') + '"' : '') + '><span class="sw-pitch">' +
      '<span class="sw-hook">Sponsor spot open:</span> <span class="sw-what"><span class="sw-what-l">one business, </span>one line on every page.</span>' +
      (nums ? '<span class="sw-br"></span> ' + nums : '') + '</span>' +
      '<a class="sw-cta" href="' + (base || '') + '/sponsor#sitewide" onclick="if(typeof gtag===\'function\')gtag(\'event\',\'sponsor_cta_click\',{cta_source:\'sitewide_open\'})">Put your business here</a></span>';
  }

  var api = { html: html, CSS: CSS };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  var doc = root.document;
  if (doc && !doc.getElementById('sw-open-css')) {
    var st = doc.createElement('style'); st.id = 'sw-open-css'; st.textContent = CSS; doc.head.appendChild(st);
  }
  root.AgsistSwOpen = api;
})(typeof window !== 'undefined' ? window : this);
