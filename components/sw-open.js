/* The open sitewide sponsor strip sells itself (Sig, Nov 13, 2026). components/loader.js loads this only when the
 * sitewide spot is unsold, into the line it already holds the room for (styles.css --sw-h), so nothing moves.
 * It prints the week's proof numbers from data/sponsor-spots.json (scripts/bake_audience.py: engaged visits and
 * Bing AI answer citations over 30 days, each source's own dates in the title, and the list count, a current
 * total) and one button to /sponsor. No price here: the price is on /sponsor. Flat colors, no gradient.
 * A figure the file does not hold is left out, never made up.
 */
(function (root) {
  'use strict';
  var CSS = '.sw-in.sw-open{display:flex;align-items:center;gap:10px;padding:3px 4px 3px 10px;border:1px solid rgba(var(--ad-orange-rgb),.55);background:rgba(var(--ad-orange-rgb),.08);color:var(--text-dim);font-size:.8rem}' +
    '.sw-pitch{flex:1 1 auto;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.3}' +
    '.sw-hook{font-weight:700;color:var(--text)}.sw-nums b{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}' +
    '.sw-nums i{font-style:normal;color:var(--text-muted)}.sw-when{color:var(--text-muted)}' +
    '.sw-in.sw-open a.sw-cta{flex:0 0 auto;display:inline-flex;align-items:center;min-height:26px;padding:3px 12px;border-radius:5px;background:var(--ad-orange);color:#1a0d05;text-decoration:none;font-weight:700;white-space:nowrap}' +
    '.sw-in.sw-open a.sw-cta:hover,.sw-in.sw-open a.sw-cta:focus-visible{background:var(--ad-orange-hi);color:#1a0d05}' +
    'html[data-theme="light"] .sw-in.sw-open a.sw-cta{background:var(--ad-orange-ink);color:#fff}' +
    'html[data-theme="light"] .sw-in.sw-open a.sw-cta:hover,html[data-theme="light"] .sw-in.sw-open a.sw-cta:focus-visible{background:#8a2e08;color:#fff}' +
    '.sw-s{display:none}' +
    '@media (max-width:700px){.sw-in.sw-open{font-size:.76rem;gap:8px}.sw-hook,.sw-l{display:none}.sw-s{display:inline}' +
    '.sw-in.sw-open a.sw-cta{min-height:38px;padding:3px 10px;white-space:normal;width:9.6em;text-align:center;line-height:1.15;font-size:.74rem;justify-content:center}}';

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(x) { return typeof x === 'number' && x > 0 ? x.toLocaleString('en-US') : ''; }
  function win(o) { return o && o.start && o.end ? o.start + ' to ' + o.end : ''; }
  function lab(l, sh) { return '<span class="sw-l">' + l + '</span><span class="sw-s">' + sh + '</span>'; }
  var DOT = '<i aria-hidden="true"> &middot; </i>';

  function html(spots, base) {
    var pr = (spots && spots.proof) || {}, ls = (spots && spots.lists) || {}, bits = [], tip = [];
    if (num(pr.engaged && pr.engaged.total)) { bits.push('<b>' + num(pr.engaged.total) + '</b> ' + lab('engaged visits', 'visits')); tip.push('Engaged visits ' + win(pr.engaged) + ', Google Analytics'); }
    if (num(pr.ai && pr.ai.total)) { bits.push('<b>' + num(pr.ai.total) + '</b> ' + lab('AI answer citations', 'AI citations')); tip.push('Bing AI answer citations ' + win(pr.ai) + ', Bing Webmaster'); }
    var nums = bits.length ? bits.join(DOT) + ' <span class="sw-when">' + lab('in 30 days', '(30 days)') + '</span>' : '';
    var lists = num(ls.people) ? [num(ls.people), lab('on our email lists', 'on our lists')] : num(ls.daily) ? [num(ls.daily), lab('on the Daily email', 'on the Daily')] : null;
    if (lists) { nums += (nums ? DOT : '') + '<b>' + lists[0] + '</b> ' + lists[1]; tip.push('Email list count of ' + ls.asOf); }
    return '<span class="sw-in sw-open"' + (tip.length ? ' title="' + esc(tip.join('. ') + '.') + '"' : '') + '><span class="sw-pitch"><span class="sw-hook">Your business here.</span> ' +
      (nums ? '<span class="sw-nums">' + nums + '</span>' : 'One line on every page.') + '</span>' +
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
