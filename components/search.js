/* search.js -- one search box for the whole site.
 *
 * Loaded by components/loader.js only when a reader opens search (the header
 * button, "/" or Ctrl/Cmd-K). The index is two static files built by
 * scripts/build_search_index.py from the repo's own pages:
 *   /data/search-index.json      pages, state pages, towns, counties, futures
 *   /data/search-elevators.json  elevator names + town (fetched right after)
 * Nothing is sent anywhere: matching runs in the browser as you type.
 *
 * Entry shape: [type, title, sub, url, keywords]
 *   type 0 page, 1 state page, 2 town, 3 county, 4 futures, 5 elevator
 */
(function () {
  'use strict';
  if (window.AgsistSearch) return;

  var GROUPS = ['Pages and tools', 'State pages', 'Cash bid towns', 'Farmland atlas counties', 'Futures contracts', 'Elevators'];
  var BASE_W = [6, 3, 2, 1, 1, 0];
  // words a type answers to, weaker than its own title and keywords
  var TYPE_WORDS = ['', 'state', 'town cash bids bid elevator', 'county atlas farmland land value rent', 'futures contract', 'elevator elevators coop'];
  var SHOW = [6, 5, 5, 5, 4, 5];
  var MAX_ED = function (n) { return n >= 8 ? 2 : n >= 4 ? 1 : 0; };
  var STATE_ABBR = { 'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD', 'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new-hampshire': 'NH', 'new-jersey': 'NJ', 'new-mexico': 'NM', 'new-york': 'NY', 'north-carolina': 'NC', 'north-dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode-island': 'RI', 'south-carolina': 'SC', 'south-dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west-virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY' };

  /* ── text ─────────────────────────────────────────────────────── */
  function norm(s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s.replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function toks(s) { var n = norm(s); return n ? n.split(' ') : []; }

  // Damerau-Levenshtein (optimal string alignment) with a cutoff
  function ed(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }

  /* ── index ────────────────────────────────────────────────────── */
  function stateOf(e) {
    var m = /\b([A-Z]{2})$/.exec(e.type === 5 ? e.sub : e.title);
    if ((e.type === 2 || e.type === 3 || e.type === 5) && m) return m[1];
    if (e.type === 1) { var p = /^\/[a-z-]+\/([a-z-]+)/.exec(e.url); return p ? STATE_ABBR[p[1]] || '' : ''; }
    return '';
  }
  // Every distinct word in the index gets an id once; a typed word is then
  // compared with each distinct word once per keystroke, not once per entry.
  var VOCAB = {}, VTOK = [], LEV_CACHE = {}, LEV_N = 0;
  function ids(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i], id = VOCAB[t];
      if (id === undefined) { id = VOCAB[t] = VTOK.length; VTOK.push(t); }
      out.push(id);
    }
    return out;
  }
  function prep(raw) {
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i], e = { type: r[0], title: r[1], sub: r[2] || '', url: r[3], i: i };
      var tt = toks(e.title);
      var kw = r[4] || '';
      if (e.type === 4 || e.type === 5) kw += ' ' + e.sub;
      e.tt = ids(tt);
      e.kt = ids(toks(kw));
      e.wt = ids(toks(TYPE_WORDS[e.type]));
      e.nt = tt.join(' ');
      e.st = stateOf(e);
      out.push(e);
    }
    return out;
  }

  // how well a typed word matches each index word: 3 exact, 2 prefix, 1 typo, 0 none
  function levels(q) {
    if (LEV_N !== VTOK.length) { LEV_CACHE = {}; LEV_N = VTOK.length; }
    if (LEV_CACHE[q]) return LEV_CACHE[q];
    var lev = new Uint8Array(VTOK.length), maxEd = MAX_ED(q.length), ql = q.length;
    for (var i = 0; i < VTOK.length; i++) {
      var t = VTOK[i];
      if (t === q) lev[i] = 3;
      else if (t.length > ql && t.lastIndexOf(q, 0) === 0) lev[i] = 2;
      else if (maxEd && t.length >= 3 && (ed(q, t, maxEd) <= maxEd ||
               (ql >= 5 && t.length > ql && ed(q, t.slice(0, ql), maxEd) <= maxEd))) lev[i] = 1;
    }
    var keys = Object.keys(LEV_CACHE);
    if (keys.length > 40) LEV_CACHE = {};
    return (LEV_CACHE[q] = lev);
  }
  function best(lev, list, noPrefix) {
    var b = 0;
    for (var i = 0; i < list.length; i++) {
      var v = lev[list[i]];
      if (noPrefix && v === 2) v = 0;
      if (v > b) { b = v; if (b === 3) break; }
    }
    return b;
  }

  var PTS = [0, 4, 6, 10];
  function score(e, qt, levs, qn, local) {
    var s = 0, inTitle = 0;
    for (var k = 0; k < qt.length; k++) {
      var lev = levs[k], short = qt[k].length < 2;
      var a = best(lev, e.tt, false);
      var b = short ? 0 : best(lev, e.kt, false);
      var c = short ? 0 : best(lev, e.wt, k !== qt.length - 1);
      var v = Math.max(PTS[a], PTS[b] * 0.6, PTS[c] * 0.35);
      if (!v) return 0;
      if (PTS[a] >= v) inTitle++;
      s += v;
    }
    if (e.nt === qn) s += 12;
    else if (e.nt.lastIndexOf(qn + ' ', 0) === 0) s += 8;
    else if (e.nt.lastIndexOf(qn, 0) === 0) s += 2;
    if (inTitle === qt.length) s += 5;
    s += BASE_W[e.type];
    if (local && e.st === local) s += 2;
    s -= e.tt.length * 0.2;
    return s;
  }

  function search(items, query, local) {
    var qn = norm(query), qt = qn ? qn.split(' ') : [];
    if (!qt.length) return [];
    var hits = [], levs = qt.map(levels);
    for (var i = 0; i < items.length; i++) {
      var s = score(items[i], qt, levs, qn, local);
      if (s > 0) hits.push({ e: items[i], s: s });
    }
    hits.sort(function (a, b) { return b.s - a.s || a.e.type - b.e.type || a.e.i - b.e.i; });
    return hits;
  }

  /* ── state ────────────────────────────────────────────────────── */
  var items = [], elevLoaded = false, mainLoaded = false, loadFailed = false;
  var root, input, list, status, closeBtn, ov, opener = null, isOpen = false, pushed = false;
  var opts = [], active = -1, expanded = {}, lastQ = null;

  function localState() {
    try { var s = localStorage.getItem('agsist_state'); if (s && /^[A-Z]{2}$/.test(s)) return s; } catch (e) {}
    var m = /^\/(?:cash-bids|farmland-atlas|basis|rent|yield|hail-map)\/([a-z-]+)/.exec(location.pathname);
    // Only breaks ties (two Dunn Counties). With no saved state and no state in
    // the address, use the site's default state, as components/state.js does.
    return m ? STATE_ABBR[m[1]] || 'WI' : 'WI';
  }

  function load() {
    if (mainLoaded || load.busy) return;
    load.busy = true;
    fetch('/data/search-index.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        items = prep(d.items || []).concat(items);
        mainLoaded = true;
        render(true);
        return fetch('/data/search-elevators.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function (d2) {
            var el = prep(d2.items || []);
            for (var i = 0; i < el.length; i++) el[i].i += 100000;
            items = items.concat(el);
            elevLoaded = true;
            render(true);
          }).catch(function () { /* towns and pages still work without elevator names */ });
      })
      .catch(function () { loadFailed = true; load.busy = false; render(true); });
  }

  /* ── DOM ──────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // wrap the parts of the title that the typed words match (word starts only)
  function mark(title, qt) {
    var spans = [];
    var low = title.toLowerCase();
    qt.forEach(function (q) {
      if (!q) return;
      var re = /[a-z0-9]+/g, m;
      while ((m = re.exec(low))) {
        var w = m[0];
        if (w.lastIndexOf(q, 0) === 0) spans.push([m.index, m.index + Math.min(q.length, w.length)]);
      }
    });
    if (!spans.length) return esc(title);
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var out = '', at = 0;
    spans.forEach(function (sp) {
      if (sp[0] < at) return;
      out += esc(title.slice(at, sp[0])) + '<mark>' + esc(title.slice(sp[0], sp[1])) + '</mark>';
      at = sp[1];
    });
    return out + esc(title.slice(at));
  }

  var SUGGEST = [
    [0, 'Cash bids near you', 'Elevator bids by ZIP', '/cash-bids'],
    [0, 'Corn futures', 'CBOT corn quotes', '/corn-futures-prices'],
    [0, 'Soybean futures', 'CBOT soybean quotes', '/soybean-futures-prices'],
    [0, 'Spray advisory', 'Can I spray today', '/spray'],
    [0, 'Farmland atlas', 'Land value, rent and risk by county', '/farmland-atlas'],
    [0, 'Cash rent by state', 'Rent by county', '/rent/']
  ];

  function build() {
    ov = document.createElement('div');
    ov.className = 'srch-ov';
    ov.hidden = true;
    root = document.createElement('div');
    root.className = 'srch';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Search AGSIST');
    root.innerHTML =
      '<div class="srch-bar">' +
        '<svg class="srch-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<label class="srch-lbl" for="srch-in">Search AGSIST</label>' +
        '<input id="srch-in" class="srch-in" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" ' +
          'aria-controls="srch-list" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" ' +
          'placeholder="Town, county, state or tool">' +
        '<button type="button" class="srch-x">Close</button>' +
      '</div>' +
      '<p class="srch-st" role="status" aria-live="polite"></p>' +
      '<div id="srch-list" class="srch-list" role="listbox" aria-label="Search results"></div>' +
      '<p class="srch-foot">Type a town, county, state, tool or contract. Use the arrow keys and Enter.</p>';
    document.body.appendChild(ov);
    document.body.appendChild(root);
    input = root.querySelector('.srch-in');
    list = root.querySelector('.srch-list');
    status = root.querySelector('.srch-st');
    closeBtn = root.querySelector('.srch-x');

    input.addEventListener('input', function () { expanded = {}; render(); });
    input.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', function () { close(); });
    ov.addEventListener('click', function () { close(); });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus in the box
    list.addEventListener('click', function (e) {
      var o = e.target.closest('[role="option"]');
      if (!o) return;
      if (o.hasAttribute('data-more')) { e.preventDefault(); more(o); return; }
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // new tab: let the browser do it
      e.preventDefault();
      go(o.getAttribute('href'));
    });
    list.addEventListener('mousemove', function (e) {
      var o = e.target.closest('[role="option"]');
      if (o) setActive(opts.indexOf(o), false);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { // keep focus inside: input <-> close
        e.preventDefault();
        (document.activeElement === input ? closeBtn : input).focus();
      }
    });
    window.addEventListener('popstate', function () { if (isOpen) close(true); });
    window.addEventListener('pageshow', function (e) { if (e.persisted && isOpen) close(true); });
  }

  function optHTML(e, id, qt) {
    return '<a role="option" id="' + id + '" class="srch-opt" href="' + esc(e.url) + '" tabindex="-1" aria-selected="false">' +
      '<span class="srch-t">' + mark(e.title, qt) + '</span>' +
      (e.sub ? '<span class="srch-s">' + esc(e.sub) + '</span>' : '') + '</a>';
  }

  function render(force) {
    if (!root) return;
    var q = input.value;
    if (!force && q === lastQ) return;
    lastQ = q;
    var qn = norm(q), qt = qn ? qn.split(' ') : [];
    var html = '', n = 0;
    if (!qt.length) {
      html += '<div role="group" aria-labelledby="srch-g-s"><div class="srch-gh" id="srch-g-s" role="presentation">Popular</div>';
      SUGGEST.forEach(function (r) { html += optHTML({ title: r[1], sub: r[2], url: r[3] }, 'srch-o' + (n++), []); });
      html += '</div>';
      status.textContent = loadFailed ? 'Search could not load. Check your connection and try again.' : '';
    } else if (!mainLoaded) {
      status.textContent = loadFailed ? 'Search could not load. Check your connection and try again.' : '';
    } else {
      var hits = search(items, q, localState());
      var groups = {}, order = [];
      hits.forEach(function (h) {
        var t = h.e.type;
        if (!groups[t]) { groups[t] = []; order.push(t); }
        groups[t].push(h.e);
      });
      order.forEach(function (t) {
        var g = groups[t], lim = expanded[t] ? Math.min(g.length, 60) : SHOW[t];
        html += '<div role="group" aria-labelledby="srch-g' + t + '"><div class="srch-gh" id="srch-g' + t + '" role="presentation">' +
          esc(GROUPS[t]) + ' <span class="srch-n">' + g.length + '</span></div>';
        for (var i = 0; i < Math.min(lim, g.length); i++) html += optHTML(g[i], 'srch-o' + (n++), qt);
        if (g.length > lim && !expanded[t]) {
          html += '<a role="option" id="srch-o' + (n++) + '" class="srch-opt srch-more" href="#" tabindex="-1" aria-selected="false" data-more="' + t + '">' +
            'Show all ' + g.length + '</a>';
        }
        html += '</div>';
      });
      status.textContent = hits.length
        ? hits.length + (hits.length === 1 ? ' match' : ' matches')
        : 'No match for “' + q.trim() + '”. Try a town, a county or a state name.';
    }
    var keep = active >= 0 && opts[active] && opts[active].hasAttribute('data-more') ? opts[active].getAttribute('data-more') : null;
    list.innerHTML = html;
    opts = Array.prototype.slice.call(list.querySelectorAll('[role="option"]'));
    input.setAttribute('aria-expanded', opts.length ? 'true' : 'false');
    var start = 0;
    if (keep != null) {
      var g = list.querySelector('#srch-g' + keep);
      var first = g && g.parentNode.querySelectorAll('[role="option"]');
      if (first && first.length) start = opts.indexOf(first[SHOW[keep]] || first[0]);
    }
    setActive(qt.length && opts.length ? Math.max(start, 0) : -1, keep != null);
  }

  function setActive(i, scroll) {
    if (active >= 0 && opts[active]) { opts[active].classList.remove('on'); opts[active].setAttribute('aria-selected', 'false'); }
    active = i;
    if (i >= 0 && opts[i]) {
      opts[i].classList.add('on');
      opts[i].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', opts[i].id);
      if (scroll) opts[i].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function more(o) {
    expanded[o.getAttribute('data-more')] = true;
    active = opts.indexOf(o);
    render(true);
  }

  function onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!opts.length) return;
      e.preventDefault();
      var d = e.key === 'ArrowDown' ? 1 : -1;
      var i = active < 0 ? (d > 0 ? 0 : opts.length - 1) : (active + d + opts.length) % opts.length;
      setActive(i, true);
    } else if (e.key === 'Enter') {
      var o = opts[active >= 0 ? active : 0];
      if (!o) return;
      e.preventDefault();
      if (o.hasAttribute('data-more')) { more(o); return; }
      go(o.getAttribute('href'));
    } else if (e.key === 'Home' && e.ctrlKey && opts.length) { e.preventDefault(); setActive(0, true); }
    else if (e.key === 'End' && e.ctrlKey && opts.length) { e.preventDefault(); setActive(opts.length - 1, true); }
  }

  function go(url) {
    // Opening search added a history entry (so Back closes it on phones).
    // Replace that entry with the result, so Back from the result lands on
    // this page, not on this page with search still open.
    if (pushed) location.replace(url);
    else location.href = url;
  }

  function open() {
    if (!root) build();
    load();
    var px = window.__agsistSearchProxy;
    if (!isOpen) {
      opener = document.activeElement && document.activeElement !== px ? document.activeElement : document.getElementById('srch-btn');
      ov.hidden = false;
      root.hidden = false;
      document.documentElement.classList.add('srch-open');
      isOpen = true;
      try { history.pushState({ agsistSearch: 1 }, ''); pushed = true; } catch (e) { pushed = false; }
      var b = document.getElementById('srch-btn');
      if (b) b.setAttribute('aria-expanded', 'true');
      render(true);
    }
    input.focus();
    input.select();
    if (px) { px.remove(); window.__agsistSearchProxy = null; }
  }

  function close(fromPop) {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    ov.hidden = true;
    document.documentElement.classList.remove('srch-open');
    var b = document.getElementById('srch-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
    if (pushed && !fromPop) { pushed = false; try { history.back(); } catch (e) {} }
    pushed = false;
    if (opener && opener.focus && document.contains(opener)) opener.focus();
  }

  window.AgsistSearch = { open: open, close: close, _norm: norm, _prep: prep, _search: search, _ed: ed };
  if (window.__agsistSearchWant) { window.__agsistSearchWant = false; open(); }
})();
