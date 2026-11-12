/* rain-find.js: "Find a county" on the rain pages (Nov 12, 2026).

   WHY. From /rain a reader needed four steps to reach a county (By county tab, state, state page, the row in a
   table of up to 250 counties), and a county page led only to its neighbours and its state. This box takes a
   county name (with or without its state) or a ZIP and opens that county's rain page.

   HOW. The page carries a plain form (form.rc-find, built by scripts/build_county_rain.py) with one input.
   On first focus this script reads /rain/find.json (written by the same build): for each state its page
   slug, name and every county, with the page slug, or for a county without a page the nearest county that
   has one. A ZIP is read from our own ZIP table (/data/places/zip/<2>.json: [lat, lon, town, state,
   county]); nothing leaves the browser. The list of matches sits over the page (no layout shift).
   Keys: arrows move, Enter opens, Escape closes. Without scripts the form opens /rain.

   window.AgRainFind = { match, norm } (node: module.exports, for the tests). */
(function (root) {
  'use strict';
  var MAX = 40;   // match keeps up to MAX; the list shows SHOW rows and says how many more
  var STNAME = { AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut',
    DE: 'delaware', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
    KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan',
    MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire',
    NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio',
    OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota',
    TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia',
    WI: 'wisconsin', WY: 'wyoming' };

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/\bsaint\b/g, 'st').replace(/\bste\.?\b/g, 'ste')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  /* the state a query names at its end ("barron wi", "barron, wisconsin"), and the rest */
  function splitState(q) {
    var n = norm(q), best = null;
    Object.keys(STNAME).forEach(function (ab) {
      [STNAME[ab], ab.toLowerCase()].forEach(function (w) {
        if (n === w || n.slice(-(w.length + 1)) === ' ' + w) {
          if (!best || w.length > best.w.length) best = { st: ab, w: w };
        }
      });
    });
    if (!best) return { st: null, q: n };
    var rest = n === best.w ? '' : n.slice(0, n.length - best.w.length - 1).trim();
    return rest ? { st: best.st, q: rest } : { st: null, q: n };   // "iowa" alone is a county name too (Iowa County)
  }
  /* idx: the find.json "s" object; returns [{name, st, href, near}] best first */
  function match(idx, query, local) {
    var sq = splitState(query), q = sq.q, hits = [];
    if (!q) return hits;
    Object.keys(idx).forEach(function (st) {
      if (sq.st && sq.st !== st) return;
      var row = idx[st], base = '/rain/' + row[0] + '/';
      row[2].forEach(function (c) {
        var n = norm(c[0]), s = 0;
        if (n === q) s = 100; else if (n.indexOf(q) === 0) s = 60; else if ((' ' + n).indexOf(' ' + q) >= 0) s = 40; else return;
        if (local && st === local) s += 5;
        hits.push({ name: c[0], st: st, href: c[1] ? base + c[1] : c[2], near: c[1] ? '' : c[3], s: s });
      });
    });
    hits.sort(function (a, b) { return b.s - a.s || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.st < b.st ? -1 : 1); });
    return hits.slice(0, MAX);
  }

  var api = { match: match, norm: norm, splitState: splitState };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgRainFind = api;
  var doc = root.document;
  if (!doc) return;

  var idxP = null;
  function loadIdx() {
    if (!idxP) idxP = fetch('/rain/find.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { return j.s || {}; })
      .catch(function () { idxP = null; return null; });
    return idxP;
  }
  function localSt() {
    var m = /^\/rain\/([a-z-]+)/.exec(location.pathname), k;
    if (!m) return null;
    for (k in STNAME) if (STNAME[k].replace(/ /g, '-') === m[1]) return k;
    return null;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function wire(form, k) {
    var input = form.querySelector('input'), lid = 'rc-find-l' + k, hits = [], act = -1, seq = 0;
    if (!input) return;
    var list = doc.createElement('ul');
    list.className = 'rc-find-l'; list.id = lid; list.setAttribute('role', 'listbox'); list.hidden = true;
    list.setAttribute('aria-label', 'Matching counties');
    var msg = doc.createElement('p');
    msg.className = 'rc-find-m'; msg.setAttribute('aria-live', 'polite');
    form.appendChild(msg);
    /* our own clear button (the browser's stock one is blue and off the palette); the input sits in a wrapper */
    var wrap = doc.createElement('span'), clr = doc.createElement('button');
    wrap.className = 'rc-find-w'; input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    clr.type = 'button'; clr.className = 'rc-find-x'; clr.hidden = true; clr.setAttribute('aria-label', 'Clear');
    clr.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    wrap.appendChild(clr); wrap.appendChild(list);   // the list sits under the input, as wide as it
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', lid); input.setAttribute('aria-expanded', 'false');

    function say(t) { msg.textContent = t || ''; }
    function show_n() { return (root.innerWidth || 1000) < 600 ? 4 : 5; }
    function shown() { return hits.slice(0, show_n()); }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); act = -1; }
    function show() {
      if (!hits.length) { close(); return; }
      var SHOW = show_n(), more = hits.length - SHOW, q = norm(input.value), sq = splitState(input.value);
      var anyNear = shown().some(function (x) { return x.near; }), h0 = hits[0], tip = (hits.length === 1 && h0.via) ? 'Opens ' + h0.name + '\u2019s rain page, the county ' + h0.via.split(',')[0] + ' sits in.' : 'Tap a county to open its rain page.' + (anyNear ? ' A county with no full-year weather station opens the nearest one that has it.' : '');
      list.innerHTML = shown().map(function (h, i) {
        return '<li role="option" id="' + lid + '-' + i + '" aria-selected="' + (i === act) + '" data-i="' + i + '">' + esc(h.name) + ', ' + h.st
          + (h.via ? ' <small>' + esc(h.via) + '</small>' : '')
          + (h.near ? ' <small>no full-year station; opens ' + esc(h.near) + '</small>' : '') + '</li>';
      }).join('') + '<li role="presentation" class="rc-find-more">' + tip + (more > 0 ? ' <span class="rc-nw">' + more + ' more:</span> '
        + (sq.st ? 'type more of the name.' : 'add the state, e.g. ' + esc(q) + ' ' + (hits.filter(function (x) { return x.st !== localSt(); })[0] || hits[0]).st.toLowerCase() + '.') : '') + '</li>';
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      if (act >= 0) input.setAttribute('aria-activedescendant', lid + '-' + act); else input.removeAttribute('aria-activedescendant');
    }
    function go(h) { if (h && h.href) location.href = h.href; }
    function zip(z) {
      var my = ++seq;
      say('Looking up ZIP ' + z + '...');
      return Promise.all([loadIdx(), fetch('/data/places/zip/' + z.slice(0, 2) + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })])
        .then(function (a) {
          if (my !== seq) return null;
          var idx = a[0], t = a[1], r = t && t[z];
          if (!idx || !Array.isArray(r) || !r[3] || !r[4]) { say('No county found for ZIP ' + z + '. Try the county name.'); return null; }
          var h = match(idx, r[4] + ' ' + r[3], r[3]).filter(function (x) { return x.st === r[3]; })[0];
          if (!h) { say('No rain page for ' + r[4] + ', ' + r[3] + '.'); return null; }
          say('ZIP ' + z + ' is in ' + h.name + ', ' + h.st + '.');
          h.via = 'ZIP ' + z + (r[2] ? ', ' + r[2] : '');
          return h;
        });
    }
    function update() {
      var v = input.value.trim(), my = ++seq;
      act = -1;
      clr.hidden = !input.value;
      if (/^\d{5}$/.test(v)) { hits = []; close(); zip(v).then(function (h) { if (h) { hits = [h]; show(); } }); return; }
      say('');
      if (norm(v).length < 2) { hits = []; close(); return; }
      loadIdx().then(function (idx) {
        if (my !== seq) return;
        if (!idx) { say('The county list did not load. Try again in a moment.'); return; }
        hits = match(idx, v, localSt());
        if (!hits.length) say('No county by that name has a rain page.');
        show();
      });
    }
    input.addEventListener('focus', loadIdx);
    input.addEventListener('input', update);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!hits.length) return;
        ev.preventDefault();
        var n = shown().length;
        act = ev.key === 'ArrowDown' ? (act + 1) % n : (act <= 0 ? n - 1 : act - 1);
        show();
      } else if (ev.key === 'Escape') { close(); }
    });
    clr.addEventListener('click', function () { input.value = ''; hits = []; say(''); close(); clr.hidden = true; input.focus(); });
    list.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    list.addEventListener('click', function (ev) {
      var li = ev.target.closest ? ev.target.closest('li[data-i]') : null;
      if (li) go(hits[+li.getAttribute('data-i')]);
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = input.value.trim();
      if (act >= 0 && hits[act]) { go(hits[act]); return; }
      if (/^\d{5}$/.test(v)) { zip(v).then(go); return; }
      if (hits.length) { go(hits[0]); return; }
      if (norm(v).length >= 2) loadIdx().then(function (idx) { if (idx) go(match(idx, v, localSt())[0]); });
    });
    var q = /[?&]q=([^&#]*)/.exec(location.search);
    if (q && k === 0) { try { input.value = decodeURIComponent(q[1].replace(/\+/g, ' ')).slice(0, 60); update(); } catch (e) {} }
  }
  function init() { Array.prototype.forEach.call(doc.querySelectorAll('form.rc-find'), wire); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof self !== 'undefined' ? self : this);
