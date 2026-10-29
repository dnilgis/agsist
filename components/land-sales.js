/* Farm sales in front of readers (Sig, Oct 27, 2026): Illinois, Wisconsin and Indiana ("Yes turn on Indiana", Oct 27),
   and Vermont (Oct 29: next land states, Vermont first).

   Data (scripts/build_land_sales.py; no names in any of it):
     /data/land-sales/latest.json     the newest monthly update in brief
     /data/land-sales/<st>.json       each county's latest few sales with the township point
   Names (STANDING-DECISIONS, Oct 27): never in a page. A "Show buyer and seller" button
   (button.ls-nm[data-ls-id][data-ls-f]) loads them on tap from /data/land/names/..., a folder
   robots.txt blocks, with a "Remove my name" link beside them.

   What it draws, each only where its host is:
     button.ls-nm                          the names tap (land-sales pages, and every block below)
     section[data-atlas-sales="county"]    Atlas county pages: "Latest farm sales here" near the top,
                                           the monthly land sale email ask beside it (IL and WI)
     #ch-live[data-st=IN|VT]               Indiana's and Vermont's Atlas county pages (no sales block of their own)
     /rent/<illinois|wisconsin|indiana|vermont>  the state's latest monthly update, above "Rent for your ground"
     [data-land-sales="home"]              the homepage Land card
     [data-land-sales="near"]              Fast Facts My place: the latest sales within 25 miles
   A file that does not load leaves its block out and says so where a reader asked for it.
   No em dashes. Plain words: "unusual price", never anything that accuses anyone. */
(function () {
  'use strict';
  if (window.AgLandSales) { window.AgLandSales.scan(); return; }
  var STATES = { IL: 'illinois', WI: 'wisconsin', IN: 'indiana', VT: 'vermont' };
  var NAMES = { IL: 'Illinois', WI: 'Wisconsin', IN: 'Indiana', VT: 'Vermont' };
  var EMAIL = { IL: 1, WI: 1, IN: 1, VT: 1 };   /* the monthly land sale email covers these (Indiana since Oct 27, Vermont Oct 29) */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NEAR_MI = 25;
  var REMOVE_TO = 'sig@agsist.com';
  var cache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(x) { return x == null ? '' : '$' + Math.round(x).toLocaleString('en-US'); }
  function acres(a) { return a == null ? 'acres not stated' : (Math.round(a * 10) / 10).toLocaleString('en-US') + ' acres'; }
  function day(iso) { if (!iso) return ''; return MON[+iso.slice(5, 7) - 1] + ' ' + (+iso.slice(8, 10)) + ', ' + iso.slice(0, 4); }
  function get(u) {
    if (!cache[u]) cache[u] = fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(function () { delete cache[u]; return null; });
    return cache[u];
  }
  function miles(a, b, c, d) {
    var R = 3958.8, p = Math.PI / 180, x = Math.sin((c - a) * p / 2), y = Math.sin((d - b) * p / 2);
    var s = x * x + Math.cos(a * p) * Math.cos(c * p) * y * y;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function css() {
    if (document.querySelector('link[href^="/components/land-sales.css"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/components/land-sales.css?v=1';
    (document.head || document.documentElement).appendChild(l);
  }

  /* ── the names tap ───────────────────────────────────────────── */
  function removeHref(id) {
    return 'mailto:' + REMOVE_TO + '?subject=' + encodeURIComponent('Remove my name, farm sale ' + id)
      + '&body=' + encodeURIComponent('Please take my name off farm sale ' + id + ' on agsist.com.');
  }
  function namesHtml(id, v) {
    if (v === 0) return '<span class="ls-nv">Names taken off this site at the owner&rsquo;s request.</span>';
    if (v == null || (Array.isArray(v) && !v[0] && !v[1])) return '<span class="ls-nv">No names on file for this sale.</span>';
    var t = Array.isArray(v)
      ? (v[0] ? 'Seller: ' + esc(v[0]) : '') + (v[0] && v[1] ? '<br>' : '') + (v[1] ? 'Buyer: ' + esc(v[1]) : '')
      : 'Buyer: ' + esc(v);
    return '<span class="ls-nv">' + t + ' <a class="ls-rm" href="' + esc(removeHref(id)) + '">Remove my name</a></span>';
  }
  function onTap(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('button.ls-nm') : null;
    if (!b || b.getAttribute('aria-busy') === 'true') return;
    var id = b.getAttribute('data-ls-id'), f = b.getAttribute('data-ls-f');
    if (!id || !/^\/data\/land\/names\//.test(f || '')) return;
    b.setAttribute('aria-busy', 'true'); b.textContent = 'Loading names';
    get(f).then(function (d) {
      b.removeAttribute('aria-busy');
      if (!d) { b.textContent = 'Names did not load. Tap to try again'; return; }
      var v = (d.sales && id in d.sales) ? d.sales[id] : (d.buyers && id in d.buyers) ? d.buyers[id] : null;
      var s = document.createElement('span');
      s.innerHTML = namesHtml(id, v);
      b.parentNode.replaceChild(s.firstChild, b);
    });
  }

  /* ── one sale, in words ──────────────────────────────────────── */
  var COLS = ['id', 'when', 'recorded', 'acres', 'price', 'ppa', 'place', 'lat', 'lng', 'flag', 'bldg'];
  function row(a) { var o = {}; for (var i = 0; i < COLS.length; i++) o[COLS[i]] = a[i]; return o; }
  function saleLi(s, county, st, namesFile, far) {
    var note = [];
    if (s.flag === 1) note.push('unusual price, above the county&rsquo;s usual');
    if (s.flag === -1) note.push('unusual price, below the county&rsquo;s usual');
    if (s.bldg) note.push('with buildings');
    return '<li><span class="ls-d">' + esc(day(s.when)) + (s.recorded ? '' : ' (deed date)') + '</span> '
      + '<b>' + esc(acres(s.acres)) + '</b> at ' + esc(s.ppa != null ? money(s.ppa) + ' an acre' : 'a price per acre not figured')
      + ' (' + esc(money(s.price)) + ')' + (s.place || county ? ', ' : '') + esc((s.place || '') + (county ? (s.place ? ', ' : '') + county + ' County, ' + st : ''))
      + (far != null ? ', ' + (far < 1 ? 'under a mile' : Math.round(far) + ' mi') : '')
      + (note.length ? ' <span class="ls-note">' + note.join('; ') + '</span>' : '')
      + ' <button type="button" class="ls-nm" data-ls-id="' + esc(s.id) + '" data-ls-f="' + esc(namesFile) + '">Show buyer and seller</button></li>';
  }
  var RULE = 'Sales with a price, acres and a whole interest in a normal sale; township or town, not the parcel.';
  function srcOnly(f) { return esc(f.source) + ', read ' + esc(day(f.fetched)); }
  var IN_RULE = 'Indiana forms carry the sale date, not a recording date, and the town is the parcel\u2019s mailing town, placed at its ZIP.';
  function srcLine(f) { return 'Source: ' + srcOnly(f) + '. ' + RULE + (f.state === 'IN' ? ' ' + IN_RULE : ''); }

  /* ── Atlas county pages ──────────────────────────────────────── */
  function atlas(sec) {
    var st = sec.getAttribute('data-st'), fips = sec.getAttribute('data-fips');
    if (!STATES[st] || !fips || sec.getAttribute('data-ls-done')) return;
    sec.setAttribute('data-ls-done', '1');
    get('/data/land-sales/' + st.toLowerCase() + '.json').then(function (f) {
      var c = f && f.counties && f.counties[fips];
      if (!c) return;
      var box = document.createElement('section');
      box.className = 'ls-feat no-print';
      box.setAttribute('aria-labelledby', 'ls-feat-h');
      var rows = (c.s || []).slice(0, 3).map(row);
      var href = '/land-sales/' + STATES[st] + '/' + c.slug;
      box.innerHTML = '<div class="ls-feat-l"><h2 id="ls-feat-h">Latest farm sales here</h2>'
        + (rows.length ? '<ul class="ls-ul">' + rows.map(function (s) { return saleLi(s, null, st, f.names_dir + fips + '.json'); }).join('') + '</ul>'
          : '<p>No sales of 10 acres or more recorded here in the last 12 months.</p>')
        + '<p><a href="' + href + '">Every recent sale in ' + esc(c.name) + ' County</a> &middot; <a href="/land-sales/">This month&rsquo;s biggest buyers and sales</a></p>'
        + '<p class="ls-fine">' + srcLine(f) + '</p></div><div class="ls-feat-r"></div>';
      /* near the top: after "What stands out", else before the key figures, else before the sales block */
      var at = document.querySelector('main section.so') || null;
      if (at) at.parentNode.insertBefore(box, at.nextSibling);
      else { var k = document.querySelector('main section.keys') || sec; k.parentNode.insertBefore(box, k); }
      /* the land sale email ask sits beside it: move the one land-alert.js put after the sales block, or start one */
      if (!EMAIL[st]) { box.querySelector('.ls-feat-r').remove(); box.style.gridTemplateColumns = '1fr'; return; }
      var ask = sec.nextElementSibling && sec.nextElementSibling.hasAttribute('data-land-alert') ? sec.nextElementSibling : null;
      sec.setAttribute('data-la-host', '1');
      if (!ask) { ask = document.createElement('div'); ask.setAttribute('data-land-alert', ''); ask.setAttribute('data-source', ('page:' + location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '')).slice(0, 60)); }
      box.querySelector('.ls-feat-r').appendChild(ask);
      if (window.AgLandAlert) window.AgLandAlert.scan();
    });
  }

  /* ── state rent pages ────────────────────────────────────────── */
  function latestLine(L, st) {
    var n = st ? (L.per_state || {})[st] : L.n;
    var big = st && L.top_state ? L.top_state[st] : (L.top || [])[0];
    return '<b>Farm sales, ' + esc(L.label) + ':</b> ' + esc(n) + ' sales of 10 acres or more recorded in ' + esc(st ? NAMES[st] : 'the states on file') + '.'
      + (big ? ' The largest by acres: ' + esc(acres(big.acres)) + ' in ' + esc(big.county) + ' County for ' + esc(money(big.price)) + '.' : '');
  }
  function rent() {
    var m = /^\/rent\/(illinois|wisconsin|indiana|vermont)(?:\.html)?\/?$/.exec(location.pathname);
    if (!m || document.querySelector('.ls-rent')) return;
    var st = { illinois: 'IL', wisconsin: 'WI', indiana: 'IN', vermont: 'VT' }[m[1]];
    get('/data/land-sales/latest.json').then(function (L) {
      if (!L || document.querySelector('.ls-rent')) return;
      var p = document.createElement('p'); p.className = 'ls-rent no-print';
      p.innerHTML = latestLine(L, st) + ' <a href="' + esc(L.url) + '">Biggest buyers, sales and unusual prices</a> &middot; <a href="/land-sales/#' + STATES[st] + '">Sales by county</a>';
      var at = document.getElementById('your-ground') || document.querySelector('main h1');
      if (!at) return;
      if (at.tagName === 'H1') at.parentNode.insertBefore(p, at.nextSibling); else at.parentNode.insertBefore(p, at);
    });
  }

  /* ── the homepage Land card ──────────────────────────────────── */
  function home(el) {
    if (el.getAttribute('data-ls-done')) return;
    el.setAttribute('data-ls-done', '1');
    get('/data/land-sales/latest.json').then(function (L) {
      if (!L) return;   /* the card keeps its plain words and its link to /land-sales/ */
      var big = (L.top || [])[0];
      var v = el.querySelector('.land-v'), s = el.querySelector('.land-s'), k = el.querySelector('.land-k');
      if (k) k.textContent = 'Farm sales, ' + L.label;
      /* same one line as the words it replaces, so the card does not change height (no layout shift) */
      if (v) v.textContent = L.n.toLocaleString('en-US') + ' recorded in ' + (L.states || []).join(', ').replace(/, ([A-Z]{2})$/, ' and $1');
      if (s) s.textContent = 'Biggest buyers and unusual prices →';
      if (L.url) el.setAttribute('href', L.url);
    });
  }

  /* ── Fast Facts My place: within 25 miles ────────────────────── */
  function near(el) {
    var H = window.AgHere && window.AgHere.state, w = H && H.where;
    if (!w || w.lat == null || w.lng == null) { el.hidden = true; return; }
    var key = (+w.lat).toFixed(3) + ',' + (+w.lng).toFixed(3);
    if (el.getAttribute('data-ls-at') === key) return;
    el.setAttribute('data-ls-at', key);
    var lat = +w.lat, lng = +w.lng;
    /* IL, WI and IN reach, and VT's: skip the fetch for a place far from all of them (rough boxes with 25 miles to spare) */
    var mid = !(lat < 37.3 || lat > 47.5 || lng < -93.3 || lng > -84.3), vt = !(lat < 42.36 || lat > 45.38 || lng < -73.95 || lng > -70.95);
    if (!mid && !vt) { el.hidden = true; el.innerHTML = ''; return; }
    Promise.all(Object.keys(STATES).map(function (st) { return get('/data/land-sales/' + st.toLowerCase() + '.json'); })).then(function (fs) {
      if (el.getAttribute('data-ls-at') !== key) return;
      var list = [], ok = [];
      fs.forEach(function (f, i) {
        if (!f) return;
        ok.push(f);
        var st = Object.keys(STATES)[i];
        Object.keys(f.counties || {}).forEach(function (fips) {
          var c = f.counties[fips];
          if (!c.ll || miles(lat, lng, c.ll[0], c.ll[1]) > NEAR_MI + 45) return;
          (c.s || []).forEach(function (a) {
            var s = row(a);
            if (s.lat == null) return;
            var d = miles(lat, lng, s.lat, s.lng);
            if (d <= NEAR_MI) list.push({ s: s, d: d, c: c, st: st, nf: f.names_dir + fips + '.json' });
          });
        });
      });
      if (!ok.length) { el.hidden = false; el.innerHTML = '<p class="ls-fine">The farm sale list did not load. Refresh in a minute.</p>'; return; }
      if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
      list.sort(function (a, b) { return a.s.when < b.s.when ? 1 : a.s.when > b.s.when ? -1 : a.d - b.d; });
      var top = list.slice(0, 6);
      var used = ok.filter(function (f) { return top.some(function (x) { return x.st === f.state; }); });
      el.hidden = false;
      el.innerHTML = '<h3>Farm sales within ' + NEAR_MI + ' miles</h3><ul class="ls-ul">'
        + top.map(function (x) { return saleLi(x.s, x.c.name, x.st, x.nf, x.d); }).join('') + '</ul>'
        + '<p class="ls-fine">The latest few recorded in each county nearby, newest first; miles to the middle of the township or town. '
        + 'Source: ' + used.map(srcOnly).join('; ') + '. ' + RULE + (used.some(function (f) { return f.state === 'IN'; }) ? ' ' + IN_RULE : '') + ' <a href="/land-sales/">Sales by county and this month&rsquo;s update</a></p>';
      /* a search link to "Land sales near <town>" lands here (#h-land-sales opens My place) */
      if (location.hash === '#h-land-sales' && !near.jumped) { near.jumped = true; try { el.scrollIntoView({ block: 'start' }); } catch (e) {} }
    });
  }

  /* ── a county page's full list (Sig, Oct 29, 2026: every recorded sale) ─────────────
     The page carries the newest 50 rows; "Show more" and the type filter read the county's list
     file (data/land-sales/<st>/<fips>.json, no names; cols id, when, recorded, acres, price, ppa,
     place, kind, flag). Both controls stay hidden until this runs, so a page without the script
     still shows its 50 rows and no dead button. */
  var STEP = 50;
  var LIST_COLS = ['id', 'when', 'recorded', 'acres', 'price', 'ppa', 'place', 'kind', 'flag'];
  function acresCell(a) { return a == null ? 'not stated' : (Math.round(a * 10) / 10).toLocaleString('en-US'); }
  function listRow(o, f) {
    var flag = o.flag === 1 ? 'Unusual price: above the county’s usual' : o.flag === -1 ? 'Unusual price: below the county’s usual' : '';
    if (o.cu) flag = (flag ? flag + '; ' : '') + 'Enrolled in current use';   /* Vermont: current use enrollment, a fact per sale */
    var when = o.when ? MON[+o.when.slice(5, 7) - 1] + ' ' + (+o.when.slice(8, 10)) + ', ' + o.when.slice(0, 4) + (o.recorded ? '' : '*') : '';
    return '<tr data-k="' + esc(o.kind) + '"><td>' + esc(when) + '</td><td>' + esc((o.place ? o.place + ', ' : '') + f.county + ' County, ' + f.st) + '</td>'
      + '<td class="n">' + esc(acresCell(o.acres)) + '</td><td class="n">' + esc(money(o.price)) + '</td><td class="n">' + esc(o.ppa != null ? money(o.ppa) : '') + '</td>'
      + '<td>' + esc((f.kinds && f.kinds[o.kind]) || '') + '</td><td>' + esc(flag) + '</td>'
      + '<td><button type="button" class="ls-nm" data-ls-id="' + esc(o.id) + '" data-ls-f="' + esc(f.names) + '">Show buyer and seller</button></td></tr>';
  }
  function listRows(f) { var C = f.cols && f.cols.length ? f.cols : LIST_COLS; return (f.s || []).map(function (a) { var o = {}; for (var i = 0; i < C.length; i++) o[C[i]] = a[i]; return o; }); }
  function fullList(box) {
    if (box.getAttribute('data-ls-done')) return;
    box.setAttribute('data-ls-done', '1');
    var url = box.getAttribute('data-ls-list'), total = +box.getAttribute('data-ls-n') || 0;
    var tb = document.querySelector('#ls-all tbody'), more = document.querySelector('.ls-more'), sel = box.querySelector('select.ls-fk');
    if (!tb || !/^\/data\/land-sales\/[a-z]{2}\/\d{5}\.json$/.test(url || '')) return;
    var btn = more ? more.querySelector('button.ls-mo') : null, shown = more ? +more.getAttribute('data-ls-shown') || STEP : total, kind = '';
    box.hidden = false;
    if (btn) btn.hidden = false;
    function words(n, of) { return 'Showing the newest ' + n + ' of ' + of + (kind ? ' ' + ((sel && sel.options[sel.selectedIndex].text.toLowerCase()) || '') : '') + ' sales. '; }
    function draw(f) {
      var all = listRows(f).filter(function (o) { return !kind || o.kind === kind; });
      tb.innerHTML = all.slice(0, shown).map(function (o) { return listRow(o, f); }).join('');
      if (!more) return;
      var n = Math.min(shown, all.length);
      var t = more.firstChild;
      if (t && t.nodeType === 3) t.nodeValue = n < all.length ? words(n, all.length) : 'All ' + all.length + (kind ? ' of this type' : '') + ' shown. ';
      if (btn) btn.hidden = n >= all.length;
    }
    function load() {
      if (btn) { btn.setAttribute('aria-busy', 'true'); }
      return get(url).then(function (f) {
        if (btn) btn.removeAttribute('aria-busy');
        if (!f || !f.s) { if (btn) btn.textContent = 'The full list did not load. Tap to try again'; return null; }
        if (btn) btn.textContent = 'Show ' + STEP + ' more';
        return f;
      });
    }
    if (btn) btn.addEventListener('click', function () { load().then(function (f) { if (f) { shown += STEP; draw(f); } }); });
    if (sel) sel.addEventListener('change', function () { kind = sel.value; load().then(function (f) { if (f) { shown = STEP; draw(f); } }); });
  }

  function scan() {
    css();
    Array.prototype.forEach.call(document.querySelectorAll('section[data-atlas-sales="county"]'), atlas);
    var am = /^\/farmland-atlas\/(indiana|vermont)\//.exec(location.pathname);
    if (am) { var cl = document.querySelector('#ch-live[data-st="' + (am[1] === 'indiana' ? 'IN' : 'VT') + '"][data-fips]'); if (cl) atlas(cl); }
    Array.prototype.forEach.call(document.querySelectorAll('.ls-flt[data-ls-list]'), fullList);
    Array.prototype.forEach.call(document.querySelectorAll('[data-land-sales="home"]'), home);
    Array.prototype.forEach.call(document.querySelectorAll('[data-land-sales="near"]'), near);
    rent();
  }
  function watchNear() {
    var el = document.querySelector('[data-land-sales="near"]');
    if (!el || !window.MutationObserver) return;
    var t = document.getElementById('h-title') || document.body, busy = false;
    var mo = new MutationObserver(function () {
      if (busy) return; busy = true;
      setTimeout(function () { busy = false; near(el); }, 200);
    });
    mo.observe(t, { childList: true, subtree: true, characterData: true });
  }

  document.addEventListener('click', onTap);
  window.AgLandSales = { scan: scan, namesHtml: namesHtml, removeHref: removeHref, miles: miles, latestLine: latestLine, listRow: listRow, listRows: listRows };
  function ready() { scan(); watchNear(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
