/* The open sitewide sponsor strip sells itself (decided Nov 13, 2026). components/loader.js loads this only when the
 * sitewide spot is unsold, into the line it already holds the room for (styles.css --sw-h), so nothing moves.
 * It says what is for sale and leads with the totals (Nov 13): one AI answer citations figure (the count the engines
 * report; only Bing reports one, for Bing and Copilot answers, and the title says so) and the people on our email lists,
 * each counted once across every list, from data/sponsor-spots.json (scripts/bake_audience.py). No engine is named in
 * the visible line (one total, not broken down by platform), and visits from AI answers are not on the strip: they
 * are a different thing from citations and are never added to them. The citations carry their 30-day window in the
 * title; the list figure is a count on the day named. One button to /sponsor, no price. Flat colors, no gradient.
 * A figure the file does not hold is left out, never made up.
 */
(function (root) {
  'use strict';
  /* Radii use the site tokens (--r-sm). Widths: above 1000 px one line in the 36 px the header holds; at 1000 px and
     under two lines in 54 px; at 640 px and under the list reads "on our lists" and "one line on every page." goes; at
     540 px and under the button reads "Advertise here"; under 390 px the list figure goes (it cannot share two lines with
     the citations at 360 px once either figure gains a digit). Never cut with an ellipsis: what does not fit is left out whole.
     Measured clean from 320 to 1440 px with every figure one digit longer than today. */
  var CSS = '.sw-in.sw-open{display:flex;align-items:center;gap:10px;padding:3px 4px 3px 10px;border:1px solid rgba(var(--ad-orange-rgb),.55);border-radius:var(--r-sm,4px);background:rgba(var(--ad-orange-rgb),.08);color:var(--text-dim);font-size:.8rem;line-height:1.3}' +
    '.sw-pitch{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap}' +
    '.sw-hook{font-weight:700;color:var(--text)}.sw-pitch b{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}' +
    '.sw-in.sw-open a.sw-cta{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-height:0;padding:1px 12px;border-radius:var(--r-sm,4px);background:var(--ad-orange);color:#1a0d05;text-decoration:none;font-weight:700;white-space:nowrap}' +
    '.sw-in.sw-open a.sw-cta:hover,.sw-in.sw-open a.sw-cta:focus-visible{background:var(--ad-orange-hi);color:#1a0d05}' +
    'html[data-theme="light"] .sw-in.sw-open a.sw-cta{background:var(--ad-orange-ink);color:#fff}' +
    'html[data-theme="light"] .sw-in.sw-open a.sw-cta:hover,html[data-theme="light"] .sw-in.sw-open a.sw-cta:focus-visible{background:#8a2e08;color:#fff}' +
    '.sw-s,.sw-cs{display:none}' +
    '@media (max-width:1000px){.sw-in.sw-open{font-size:.78rem;gap:8px}.sw-pitch{white-space:normal}.sw-in.sw-open a.sw-cta{min-height:0;padding:2px 8px;white-space:normal;width:8.8em;align-self:center;text-align:center;line-height:1.15;font-size:.76rem}}' +
    '@media (max-width:640px){.sw-what,.sw-l{display:none}.sw-s{display:inline}}' +
    '@media (max-width:540px){.sw-in.sw-open{gap:6px;padding-left:8px}.sw-in.sw-open a.sw-cta{width:6.4em;padding:2px 5px;overflow-wrap:normal;word-break:normal;hyphens:none}.sw-cl{display:none}.sw-cs{display:inline}}' +
    '@media (min-width:1001px) and (max-width:1100px){.sw-em{display:none}}' +
    '@media (max-width:389px){.sw-pp{display:none}.sw-in.sw-open{gap:5px;padding-left:7px}.sw-in.sw-open a.sw-cta{width:6em;padding:2px 3px}}';

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(x) { return typeof x === 'number' && x > 0 ? x.toLocaleString('en-US') : ''; }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(s, y) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + (y ? ', ' + m[1] : '') : '';
  }
  function win(o) {
    if (!(o && day(o.start) && day(o.end))) return '';
    return day(o.start, o.start.slice(0, 4) !== o.end.slice(0, 4)) + ' to ' + day(o.end, true);
  }
  function lab(l, sh) { return '<span class="sw-l">' + l + '</span><span class="sw-s">' + sh + '</span>'; }

  /* "Sponsor spot open: one line on every page." then the totals: AI answer citations over their 30 days and the people
     on our lists (a count on the day named), then the button. Engaged visits, search clicks and visits from AI answers
     stay on /sponsor. */
  function html(spots, base) {
    var pr = (spots && spots.proof) || {}, li = (spots && spots.lists) || {}, ai = pr.ai, line = '', tip = [];
    if (num(ai && ai.total) && win(ai)) {
      line = '<span class="sw-ai"><b>' + num(ai.total) + '</b> AI answer citations in 30 days</span>';
      tip.push('AI answer citations ' + win(ai) + ': the count Bing reports for Bing and Copilot answers. Other AI engines report no count');
    }
    if (num(li.people) && day(li.asOf)) {
      line += '<span class="sw-pp">' + (line ? lab(' and ', ' &middot; ') : '') + '<b>' + num(li.people) + '</b> ' +
        lab('people on our <span class="sw-em">email </span>lists', 'on our lists') + '</span>';
      tip.push('People on our email lists on ' + day(li.asOf, true) + ', each counted once' + (num(li.daily) ? ' (' + num(li.daily) + ' get the Daily)' : ''));
    }
    return '<span class="sw-in sw-open"' + (tip.length ? ' title="' + esc(tip.join('. ') + '.') + '"' : '') + '><span class="sw-pitch">' +
      '<span class="sw-hook">Sponsor spot open:</span> <span class="sw-what">one line on every page.</span>' +
      (line ? ' ' + line + '.' : '') + '</span>' +
      '<a class="sw-cta" href="' + (base || '') + '/sponsor#sitewide" onclick="if(typeof gtag===\'function\')gtag(\'event\',\'sponsor_cta_click\',{cta_source:\'sitewide_open\'})">' +
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
