/* Farm sales in front of readers (Oct 27, 2026): Illinois, Wisconsin and Indiana ("Yes turn on Indiana", Oct 27),
   and Vermont and New Jersey (Oct 29: next land states).

   Data (scripts/build_land_sales.py; no names in any of it):
     /data/land-sales/latest.json     the newest monthly update in brief
     /data/land-sales/<st>.json       each county's latest few sales with the township point
   Names (a site rule, Oct 27): never in a page. A "Show buyer and seller" button
   (button.ls-nm[data-ls-id][data-ls-f]) loads them on tap from /data/land/names/..., a folder
   robots.txt blocks, with a "Remove my name" link beside them.

   What it draws, each only where its host is:
     button.ls-nm                          the names tap (land-sales pages, and every block below)
     section[data-atlas-sales="county"]    Atlas county pages: "Latest farm sales here" near the top,
                                           the monthly land sale email ask beside it (IL and WI)
     #ch-live[data-st=IN|VT|NJ]            Indiana's, Vermont's and New Jersey's Atlas county pages (no sales block of their own)
     /rent/<illinois|wisconsin|indiana|vermont|new-jersey>  the state's latest monthly update, above "Rent for your ground"
     [data-land-sales="home"]              the homepage Land card
     [data-land-sales="near"]              Fast Facts My place: the latest sales within 25 miles
   A file that does not load leaves its block out and says so where a reader asked for it.
   No em dashes. Plain words: "unusual price", never anything that accuses anyone. */
(function () {
  'use strict';
  if (window.AgLandSales) { window.AgLandSales.scan(); return; }
  var STATES = { IL: 'illinois', WI: 'wisconsin', IN: 'indiana', VT: 'vermont', NJ: 'new-jersey', FL: 'florida' };
  var NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  /* Florida (Nov 5, 2026): its files give the sale month, not the day, so its dates show as months; its county
     transfer files are on agsist-data (FSLand.LAND_HOST), and a big county keeps older years in their own files */
  var MONTH = { FL: 1 };
  var HOST = { FL: 'https://dnilgis.github.io/agsist-data/land/fl/' };
  var EMAIL = { IL: 1, WI: 1, IN: 1, VT: 1, NJ: 1 };   /* the monthly land sale email covers these (Indiana since Oct 27, Vermont and New Jersey Oct 29) */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NEAR_MI = 25;
  var REMOVE_TO = 'sig@agsist.com';
  var cache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(x) { return x == null ? '' : '$' + Math.round(x).toLocaleString('en-US'); }
  function acres(a) { return a == null ? 'acres not stated' : (Math.round(a * 10) / 10).toLocaleString('en-US') + ' acres'; }
  function day(iso) { if (!iso) return ''; return MON[+iso.slice(5, 7) - 1] + ' ' + (+iso.slice(8, 10)) + ', ' + iso.slice(0, 4); }
  function mon(iso) { if (!iso) return ''; return MON[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4); }
  /* a sale's date: the day, or the month alone for a state whose files give months (never a first-of-month day) */
  function when(iso, st) { return MONTH[String(st || '').toUpperCase()] ? mon(iso) : day(iso); }
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
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/components/land-sales.css?v=2';
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
      /* this button and any other for the same sale and file (the row's and its detail panel's) */
      /* a legal description held back because it names a party comes with the names */
      var lg = d.legals && d.legals[id];
      Array.prototype.forEach.call(document.querySelectorAll('span.ls-lgh[data-ls-id="' + id + '"]'), function (x) {
        x.textContent = lg || 'not in our copy';
      });
      Array.prototype.forEach.call(document.querySelectorAll('button.ls-nm'), function (x) {
        if (x !== b && (x.getAttribute('data-ls-id') !== id || x.getAttribute('data-ls-f') !== f)) return;
        var s = document.createElement('span');
        s.innerHTML = namesHtml(id, v);
        x.parentNode.replaceChild(s.firstChild, x);
      });
    });
  }

  /* ── one sale, in words ──────────────────────────────────────── */
  var COLS = ['id', 'when', 'recorded', 'acres', 'price', 'ppa', 'place', 'lat', 'lng', 'flag', 'bldg'];
  function row(a, cols) { var C = cols && cols.length ? cols : COLS, o = {}; for (var i = 0; i < C.length; i++) o[C[i]] = a[i]; return o; }
  function saleLi(s, county, st, namesFile, far, c, fips) {
    var note = [];
    if (s.flag === 1) note.push('unusual price, above the county&rsquo;s usual');
    if (s.flag === -1) note.push('unusual price, below the county&rsquo;s usual');
    if (s.bldg) note.push('with buildings');
    if (s.kind === 'a') note.unshift('Auction result' + (s.au ? ', reported by ' + esc(s.au[0]) : ''));
    var det = c && fips && s.ri !== undefined ? attrs(s, st, fips, c.name, c.usual, c.w24, c.rec) : '';
    return '<li' + det + '><span class="ls-d">' + esc(when(s.when, st)) + (s.recorded || MONTH[st] ? '' : ' (deed date)') + '</span> '
      + '<b>' + esc(acres(s.acres)) + '</b> at ' + esc(s.ppa != null ? money(s.ppa) + ' an acre' : 'a price per acre not figured')
      + ' (' + esc(money(s.price)) + ')' + (s.place || county ? ', ' : '') + esc((s.place || '') + (county ? (s.place ? ', ' : '') + county + ' County, ' + st : ''))
      + (far != null ? ', ' + (far < 1 ? 'under a mile' : Math.round(far) + ' mi') : '')
      + (note.length ? ' <span class="ls-note">' + note.join('; ') + '</span>' : '')
      + (namesFile && s.kind !== 'a' ? ' <button type="button" class="ls-nm" data-ls-id="' + esc(s.id) + '" data-ls-f="' + esc(namesFile) + '">Show buyer and seller</button>' : '')
      + (det ? ' <button type="button" class="ls-dt ls-dtc" aria-expanded="false">Details<span class="ls-sr"> of this sale</span></button>' : '') + '</li>';
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
      var rows = (c.s || []).slice(0, 3).map(function (a) { var o = row(a, f.cols); if (c.lx && c.lx[o.id]) o.lx = c.lx[o.id]; if (c.au && c.au[o.id]) o.au = c.au[o.id]; return o; });
      var href = '/land-sales/' + STATES[st] + '/' + c.slug;
      box.innerHTML = '<div class="ls-feat-l"><h2 id="ls-feat-h">Latest farm sales here</h2>'
        + (rows.length ? '<ul class="ls-ul">' + rows.map(function (s) { return saleLi(s, null, st, f.names_dir ? f.names_dir + fips + '.json' : null, null, c, fips); }).join('') + '</ul>'
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
    var m = /^\/rent\/(illinois|wisconsin|indiana|vermont|new-jersey)(?:\.html)?\/?$/.exec(location.pathname);
    if (!m || document.querySelector('.ls-rent')) return;
    var st = { illinois: 'IL', wisconsin: 'WI', indiana: 'IN', vermont: 'VT', 'new-jersey': 'NJ' }[m[1]];
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
    /* IL, WI and IN reach, VT's and NJ's: skip the fetch for a place far from all of them (rough boxes with 25 miles to spare) */
    var mid = !(lat < 37.3 || lat > 47.5 || lng < -93.3 || lng > -84.3), vt = !(lat < 42.36 || lat > 45.38 || lng < -73.95 || lng > -70.95),
      nj = !(lat < 38.56 || lat > 41.72 || lng < -76.03 || lng > -73.42), fl = !(lat < 24.0 || lat > 31.4 || lng < -88.1 || lng > -79.6);
    /* auction results (land_auctions.py): states with no transfer returns have a small file of their own; /data/land-sales/auctions.json
       names them with a box, so a place far from all of them fetches nothing */
    get('/data/land-sales/auctions.json').then(function (ix) {
      var extra = Object.keys((ix && ix.states) || {}).filter(function (a) { var b = ix.states[a].box; return b && lat >= b[0] - 0.4 && lat <= b[2] + 0.4 && lng >= b[1] - 0.5 && lng <= b[3] + 0.5; });
      if (!mid && !vt && !nj && !fl && !extra.length) { el.hidden = true; el.innerHTML = ''; return; }
      var sts = (mid || vt || nj || fl ? Object.keys(STATES) : []).concat(extra);
      return Promise.all(sts.map(function (st) { return get('/data/land-sales/' + st.toLowerCase() + '.json'); })).then(function (fs) { nearDraw(fs, sts); });
    });
    function nearDraw(fs, sts) {
      if (el.getAttribute('data-ls-at') !== key) return;
      var list = [], ok = [];
      fs.forEach(function (f, i) {
        if (!f) return;
        ok.push(f);
        var st = sts[i];
        Object.keys(f.counties || {}).forEach(function (fips) {
          var c = f.counties[fips];
          if (!c.ll || miles(lat, lng, c.ll[0], c.ll[1]) > NEAR_MI + 45) return;
          (c.s || []).forEach(function (a) {
            var s = row(a, f.cols);
            if (c.lx && c.lx[s.id]) s.lx = c.lx[s.id];
            if (c.au && c.au[s.id]) s.au = c.au[s.id];
            if (s.lat == null) return;
            var d = miles(lat, lng, s.lat, s.lng);
            if (d <= NEAR_MI) list.push({ s: s, d: d, c: c, st: st, nf: f.names_dir ? f.names_dir + fips + '.json' : null, fips: fips });
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
        + top.map(function (x) { return saleLi(x.s, x.c.name, x.st, x.nf, x.d, x.c, x.fips); }).join('') + '</ul>'
        + '<p class="ls-fine">The latest few recorded in each county nearby, newest first; miles to the middle of the township or town. '
        + 'Source: ' + used.map(srcOnly).join('; ') + '. ' + RULE + (used.some(function (f) { return f.state === 'IN'; }) ? ' ' + IN_RULE : '')
        + (top.some(function (x) { return x.s.kind === 'a'; }) ? ' A row marked Auction result is reported by the auction company, dated by the auction day and placed at the middle of its county.' : '')
        + ' <a href="/land-sales/">Sales by county and this month&rsquo;s update</a></p>';
      /* a search link to "Land sales near <town>" lands here (#h-land-sales opens My place) */
      if (location.hash === '#h-land-sales' && !near.jumped) { near.jumped = true; try { el.scrollIntoView({ block: 'start' }); } catch (e) {} }
    }
  }

  /* ── a county page's full list (Oct 29, 2026: every recorded sale) ─────────────
     The page carries the newest 50 rows; "Show more" and the type filter read the county's list
     file (data/land-sales/<st>/<fips>.json, no names; cols id, when, recorded, acres, price, ppa,
     place, kind, flag). Both controls stay hidden until this runs, so a page without the script
     still shows its 50 rows and no dead button. */
  var STEP = 50;
  var LIST_COLS = ['id', 'when', 'recorded', 'acres', 'price', 'ppa', 'place', 'kind', 'flag'];
  function acresCell(a) { return a == null ? 'not stated' : (Math.round(a * 10) / 10).toLocaleString('en-US'); }
  var NONAMES = false;   /* a table with no Names column (a page of auction results only) */
  function listRow(o, f) {
    var flag = o.flag === 1 ? 'Unusual price: above the county’s usual' : o.flag === -1 ? 'Unusual price: below the county’s usual' : '';
    if (o.cu) flag = (flag ? flag + '; ' : '') + 'Enrolled in current use';   /* Vermont: current use enrollment, a fact per sale */
    var dm = f.dates === 'month' || MONTH[f.st];
    var when = o.when ? (dm ? mon(o.when) : MON[+o.when.slice(5, 7) - 1] + ' ' + (+o.when.slice(8, 10)) + ', ' + o.when.slice(0, 4) + (o.recorded ? '' : '*')) : '';
    var dls = o.ri !== undefined ? ' data-ls="' + esc(JSON.stringify(DCOLS.map(function (k) { return k === 'cu' ? (o.cu ? 1 : 0) : o[k] == null ? null : o[k]; }))) + '"' : '';
    return '<tr data-k="' + esc(o.kind) + '"' + dls + '><td>' + esc(when) + '</td><td>' + esc((o.place ? o.place + ', ' : '') + f.county + ' County, ' + f.st) + '</td>'
      + '<td class="n">' + esc(acresCell(o.acres)) + '</td><td class="n">' + esc(money(o.price)) + '</td><td class="n">' + esc(o.ppa != null ? money(o.ppa) : '') + '</td>'
      + '<td>' + esc((f.kinds && f.kinds[o.kind]) || '') + '</td><td>' + esc([flag, o.kind === 'a' && o.au ? tractWords(o.au) : ''].filter(Boolean).join('; ')) + '</td>'
      /* a state whose file names no one (Florida, New Jersey: names null): no button that would load nothing */
      + (NONAMES ? '' : '<td>' + (f.names && o.kind !== 'a' ? '<button type="button" class="ls-nm" data-ls-id="' + esc(o.id) + '" data-ls-f="' + esc(f.names) + '">Show buyer and seller</button>' : '') + '</td>') + '</tr>';
  }
  function listRows(f) { var C = f.cols && f.cols.length ? f.cols : LIST_COLS; return (f.s || []).map(function (a) { var o = {}; for (var i = 0; i < C.length; i++) o[C[i]] = a[i]; if (f.lx && f.lx[o.id]) o.lx = f.lx[o.id]; if (f.au && f.au[o.id]) { o.au = f.au[o.id]; if (o.au[1]) AUURL[o.id] = o.au[1]; } return o; }); }
  function fullList(box) {
    if (box.getAttribute('data-ls-done')) return;
    box.setAttribute('data-ls-done', '1');
    var url = box.getAttribute('data-ls-list'), total = +box.getAttribute('data-ls-n') || 0;
    var tb = document.querySelector('#ls-all tbody'), more = document.querySelector('.ls-more'), sel = box.querySelector('select.ls-fk');
    if (!tb || !/^\/data\/land-sales\/[a-z]{2}\/\d{5}\.json$/.test(url || '')) return;
    var btn = more ? more.querySelector('button.ls-mo') : null, shown = more ? +more.getAttribute('data-ls-shown') || STEP : total, kind = '';
    var th = tb.parentNode && tb.parentNode.tHead; NONAMES = !!th && !/Names/.test(th.textContent);
    box.hidden = false;
    if (btn) btn.hidden = false;
    function words(n, of) { return 'Showing the newest ' + n + ' of ' + of + (kind ? ' ' + ((sel && sel.options[sel.selectedIndex].text.toLowerCase()) || '') : '') + ' sales. '; }
    function draw(f) {
      var all = listRows(f).filter(function (o) { return !kind || o.kind === kind; });
      tb.innerHTML = all.slice(0, shown).map(function (o) { return listRow(o, f); }).join('');
      rowButtons(tb);
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

  /* ── one sale, every pertinent detail (Nov 4, 2026) ──────────────────────────────────────────────────────────
     Every sale row (the county table, a month table) and every sale card (Atlas, Fast Facts) opens a panel.
     What the page already has draws at once (data-ls on the row: DCOLS, scripts/build_land_sales.py ROW_COLS;
     data-ls-c on the row or its table: state, county fips and name, the county's 24-month middle). The deed's
     own record (document, deed type, parcel, legal, section, class, exemption and the rest) comes from the
     county's transfer file, /data/land/<st>/<fips>.json, the robots-blocked file Field Scout already reads, row
     ri, read once per county on the first tap; the row is used only when its hash matches the sale id. That
     file carries buyer and seller too: this panel never reads them except to blank them out of a legal
     description. Names show only on "Show buyer and seller", as everywhere. A field the state's record does
     not have says "not in the state record"; one the state has and our copy does not yet keep says so. */
  var DCOLS = ['id', 'when', 'recorded', 'acres', 'price', 'ppa', 'place', 'kind', 'flag', 'cu', 'ri', 'g', 'm', 'lx', 'au'];
  /* the only columns of the county file this panel takes; every other column (the names among them) is never read */
  var KEEP = ['doc', 'date', 'price', 'acres', 'tac', 'np', 'cls', 'conv', 'pid', 'muni', 'legal', 'str', 'exempt', 'ac1', 'rec', 'acx',
    'pp', 'rr', 'mfl', 'fin', 'use0', 'use1', 'glv', 'avl', 'avb', 'avy', 'lsf', 'yb'];
  var NOT_REC = 'not in the state record', NOT_YET = 'not in our copy yet';
  var KINDW = { f: 'farmland', b: 'with buildings', w: 'forest', s: 'small parcel (under 20 acres)' };
  var MIDW = { b: 'it has buildings', w: 'it is forest land', a: 'the record does not state the acres', s: 'it is under 20 acres',
    p: 'it sold for under $500 an acre', o: 'it is outside the 24 months the middle covers' };
  var STF = {   /* each state's record, in its own words; null: the state's record does not carry it */
    IL: { form: 'declaration', doc: 'Document number', deed: 'Deed date (instrument date)', rec: 'Recorded (filed)', place: 'Township',
      pid: 'Parcel number (PIN)', price: 'Net consideration (Line 13 of Form PTAX-203: full consideration less personal property), or full consideration (Line 11) when Line 13 is blank.',
      cls: { '4': 'Farm (the declaration’s current use, Line 8)' }, bldg: null, tax: 'State transfer tax', extra: ['pp'] },
    IN: { form: 'sales disclosure form', doc: 'Sales disclosure form', deed: 'Sale date on the form', rec: null, place: 'Mailing town (placed at its ZIP)',
      pid: 'Parcel number', price: 'Sales price (E1) less personal property (E2) on the Indiana sales disclosure form.',
      cls: { '1': 'Residential', '2': 'Commercial', '3': 'Industrial', '4': 'Farm land', '6': 'Timber (class 120)', '7': 'Farm buildings (an improved farm parcel)' }, bldg: 1, tax: null, extra: [] },
    WI: { form: 'return', doc: 'Document number', deed: 'Conveyance date', rec: 'Recorded', place: 'Town, village or city',
      pid: 'Parcel number', price: 'Sale price on the Wisconsin transfer return.',
      cls: { '1': 'Residential', '2': 'Commercial', '3': 'Manufacturing', '4': 'Agricultural', '5': 'Undeveloped', '5M': 'Agricultural forest', '6': 'Productive forest', '7': 'Other (farm buildings)', 'X': 'Exempt' },
      bldg: 1, tax: 'Transfer fee', extra: ['rr', 'mfl'] },
    VT: { form: 'return', doc: 'Transfer tax return', deed: 'Closing date', rec: 'Recorded by the town', place: 'Town',
      pid: 'SPAN (the state’s parcel number)', price: 'Value paid or transferred on the Vermont property transfer tax return (Form PTT-172).',
      cls: { '1': 'House', '2': 'Commercial building', '3': 'Factory', '4': 'Operating farm', '5': 'Open land in current use', '6': 'Timberland', '7': 'Farm or other buildings' },
      bldg: 1, tax: 'Property transfer tax', extra: ['fin', 'use0', 'use1', 'glv'] },
    NJ: { form: 'deed abstract', doc: 'District and deed serial (SR-1A)', deed: 'Deed date', rec: 'Recorded', place: 'Municipality',
      pid: 'Block and lot', price: 'Sale price on the New Jersey deed abstract (SR-1A).',
      cls: { '1': 'House (farmhouse lot 3A, or residential 2)', '2': 'Commercial (4A)', '3': 'Industrial (4B)', '4': 'Farm (3A or 3B)', '5': 'Vacant land (1)', 'X': 'Exempt (15)' },
      bldg: 1, tax: 'Realty transfer fee', extra: ['avl', 'avb', 'avy', 'lsf', 'yb'] },
    /* Florida: the Department of Revenue sale data file; month of sale, no recording date, no transfer tax line */
    FL: { form: 'deed', doc: 'Clerk instrument or book and page', deed: 'Sale month', rec: null, place: 'Town',
      pid: 'Parcel number', price: 'Sale price on the Florida sale data file.',
      cls: { '4': 'Agricultural land', '6': 'Timberland', '7': 'Improved (buildings)' }, bldg: 1, tax: null, extra: [], month: 1 }
  };
  /* the sale-kind words the fetcher writes after the deed type (scripts/fetch_land_sales.py il_flags, in_flags, wi_flags,
     vt_table, nj_table), in plain sentences */
  var FLAGW = {
    'less than full interest': 'Less than the whole interest changed hands.',
    'auction': 'Sold at auction.',
    'adjacent owner': 'The buyer owns land next to it.',
    'installment contract': 'An installment (land) contract.',
    'advertised': 'The property was advertised for sale.',
    'not advertised': 'The property was not advertised for sale.',
    'split parcel': 'Part of a parcel (a split): the lot size on the record may be the whole parcel’s, so no acres are counted.',
    'with buildings': 'The record shows buildings on it.',
    'land only': 'Land only, no buildings on the record.',
    'court ordered': 'The form marks a court order.',
    'valid for trending': 'The county assessor marked it valid for trending (Indiana’s own call that it is a fair market sale).',
    'not valid for trending': 'The county assessor marked it not valid for trending (Indiana’s own call; most Indiana farm sales carry it).',
    'enrolled in current use': 'Enrolled in Vermont’s current use program (taxed on its farm or forest use).',
    'not on the 2026 assessment list': 'A lot it names is not on the 2026 assessment list, so the acres are not known.',
    'seller financed': 'The seller financed the sale.',
    'relocation company': 'A relocation company is the buyer or seller.',
    'financial institution or government agency': 'A bank, other lender or government agency is the buyer or seller.',
    'real estate investment trust': 'The buyer is a real estate investment trust.',
    'pension fund': 'The buyer is a pension fund.',
    'buyer exercising an option': 'The buyer was exercising an option to buy.',
    'new construction': 'New construction since January 1 of the year before the sale.',
    'demolition or damage': 'Demolition or damage since January 1 of the year before the sale.',
    'additions or remodeling': 'Additions or major remodeling since January 1 of the year before the sale.'
  };
  var RR = { none: 'None', life: 'The seller keeps a life estate (use of the land for life).', ease: 'The seller keeps an easement.', other: 'The seller keeps other rights in the land.' };
  var pend = {}, seq = 0;

  /* SHA-1, for the sale id check (land_alert.sale_id: sha1 of state|fips|document|deed date|price, first 10 hex) */
  function sha1(s) {
    var u = unescape(encodeURIComponent(s)), n = u.length, w = [], i, j;
    for (i = 0; i < n; i++) w[i >> 2] |= u.charCodeAt(i) << (24 - (i % 4) * 8);
    w[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
    w[(((n + 8) >> 6) + 1) * 16 - 1] = n * 8;
    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0, W = new Array(80);
    for (i = 0; i < w.length; i += 16) {
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (j = 0; j < 80; j++) {
        W[j] = j < 16 ? (w[i + j] | 0) : (function (x) { return (x << 1) | (x >>> 31); })(W[j - 3] ^ W[j - 8] ^ W[j - 14] ^ W[j - 16]);
        var f = j < 20 ? (b & c) | (~b & d) : j < 40 ? b ^ c ^ d : j < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        var k = j < 20 ? 0x5A827999 : j < 40 ? 0x6ED9EBA1 : j < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        var t = (((a << 5) | (a >>> 27)) + f + e + k + W[j]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  function pyStr(v) { return v == null ? 'None' : String(v); }
  function saleKey(st, fips, o, price) { return [st, fips, pyStr(o.doc), String(o.date || '').slice(0, 10), Math.round(+price || 0)].join('|'); }
  function recOf(f, s, st) {
    /* the sale's first deed in the county file: row ri when its hash is the sale id, else any row that hashes to it */
    if (!f || !f.cols || !f.rows) return null;
    var C = f.cols, obj = function (a) { var o = {}; for (var i = 0; i < C.length; i++) if (KEEP.indexOf(C[i]) >= 0) o[C[i]] = a[i]; return o; };
    var fips = f.fips;
    if (s.ri != null && f.rows[s.ri]) { var o = obj(f.rows[s.ri]); if (sha1(saleKey(st, fips, o, s.price)).slice(0, 10) === s.id) return o; }
    for (var i = 0; i < f.rows.length; i++) { var x = obj(f.rows[i]); if (sha1(saleKey(st, fips, x, s.price)).slice(0, 10) === s.id) return x; }
    return null;
  }
  function parse(v) { try { return JSON.parse(v); } catch (e) { return null; } }
  function saleOf(el) {
    if (el._ls) return el._ls;
    var a = parse(el.getAttribute('data-ls')), c = el.closest('[data-ls-c]'), x = c ? parse(c.getAttribute('data-ls-c')) : null;
    if (!a || !x) return null;
    var s = {};
    for (var i = 0; i < DCOLS.length; i++) s[DCOLS[i]] = a[i];
    s.st = x[0]; s.fips = x[1]; s.county = x[2]; s.u = x[3]; s.w24 = x[4]; s.rec = x[5] === 1;
    el._ls = s;
    return s;
  }
  function attrs(o, st, fips, county, u, w24, rec) {
    /* data-ls and data-ls-c for a card drawn here, the same shape the builder writes on a row */
    return ' data-ls="' + esc(JSON.stringify(DCOLS.map(function (k) { return o[k] == null ? null : o[k]; }))) + '" data-ls-c="'
      + esc(JSON.stringify([st, fips, county, u ? [u.med, u.q1, u.q3, u.n].concat(u.auctions ? [u.auctions] : []) : null, w24 || null, rec ? 1 : 0])) + '"';
  }
  function miss(t) { return '<span class="ls-miss">' + esc(t) + '</span>'; }
  function dl(rows) {
    return '<dl class="ls-dl">' + rows.filter(Boolean).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + (r[2] ? '<span class="ls-dn">' + esc(r[2]) + '</span>' : '') + '</dd>'; }).join('') + '</dl>';
  }
  function grp(t, rows) { return '<h3 class="ls-dh">' + esc(t) + '</h3>' + dl(rows); }
  function pct(a, b) { var p = Math.round((a / b - 1) * 100); return p === 0 ? 'right at' : p > 1000 ? 'about ' + Math.round(p / 100 + 1).toLocaleString('en-US') + ' times' : Math.abs(p) + '% ' + (p > 0 ? 'above' : 'below'); }
  function clsWords(c, T) { return String(c || '').split(/[\s,;/]+/).filter(Boolean).map(function (x) { return T[x.toUpperCase()] || ('class ' + x); }).join(', '); }
  function flagsOf(conv) {
    var parts = String(conv || '').split('; ').map(function (x) { return x.trim(); }).filter(Boolean);
    var deed = parts.length && !FLAGW[parts[0].toLowerCase()] && !/^state ratio study code/i.test(parts[0]) ? parts.shift() : '';
    return { deed: deed, flags: parts };
  }
  function flagSentence(w) {
    var k = w.toLowerCase(), m = /^state ratio study code (\d+): (.*)$/i.exec(w);
    if (FLAGW[k]) return FLAGW[k];
    if (m) return 'New Jersey’s ratio study code ' + m[1] + ': ' + m[2] + '. The code keeps it out of the state’s assessment study only; it stays a market sale here.';
    return w.charAt(0).toUpperCase() + w.slice(1) + '.';
  }
  /* the legal description with the sale's own buyer and seller blanked: the builder found where they sit
     (build_land_sales.legal_mask, lx), so this never reads a name */
  function scrub(legal, lx, nf) {
    var t = String(legal || ''), w = nf ? '[name: tap Show buyer and seller]' : '[name left out]';
    (lx || []).slice().sort(function (a, b) { return b[0] - a[0]; }).forEach(function (m) {
      t = t.slice(0, m[0]) + w + t.slice(m[0] + m[1]);
    });
    /* county files written since Nov 4, 2026 carry the mark already (scripts/land_names.py NAME_MARK) */
    return t.split('[NAME]').join(w);
  }
  function namesBtnHtml(id, nf) { return '<button type="button" class="ls-nm" data-ls-id="' + esc(id) + '" data-ls-f="' + esc(nf) + '">Show buyer and seller</button>'; }

  function panelHtml(s, f, r, nf, state) {
    var T = STF[s.st] || STF.WI, st = s.st;
    var has = function (c) { return !!(f && f.cols && f.cols.indexOf(c) >= 0); };
    var rv = function (c) { return r && r[c] != null && r[c] !== '' ? r[c] : null; };
    var wait = state === 'wait' ? miss('loading the record') : null,
      gone = state === 'gone' ? miss('the record did not load') : state === 'later' ? miss(NOT_YET) : null;
    var fromRec = function (c, html) { return wait || gone || (!has(c) ? miss(NOT_YET) : rv(c) == null ? miss(NOT_REC) : html(rv(c))); };
    var cf = r ? flagsOf(r.conv) : { deed: '', flags: [] };
    var dd = s.when ? when(s.when, st) : '';
    var g = +s.g || 1;
    var out = [];
    var FL = st === 'FL', flc = FL && r ? /Florida code (\w+): ([^;]*)/.exec(String(r.conv || '')) : null;
    /* the sale */
    var tillN = 'No state on this site records tillable acres; a soil and crop map of the parcel is the way to judge it.';
    out.push(grp('Sale', [
      T.month ? null : [T.rec ? T.rec : 'Recorded', T.rec ? (s.recorded ? esc(dd) : fromRec('rec', function (v) { return esc(day(v)); })) : miss(NOT_REC),
        T.rec ? null : 'Indiana’s form carries the sale date, not a recording date.'],
      [T.deed, fromRec('date', function (v) { return esc(T.month ? mon(String(v).slice(0, 10)) : day(String(v).slice(0, 10))); }), T.month ? 'Florida’s sale data file gives the month of each sale, not the day.' : null],
      ['Price', s.price != null ? esc(money(s.price)) : miss(NOT_REC), T.price + (g > 1 ? ' ' + g + ' deeds of this parcel within 31 days, counted as one sale at their total price; the record below is the first deed.' : '')],
      ['Price per acre', s.ppa != null ? esc(money(s.ppa)) : miss('not figured'), s.ppa != null ? 'Price over total acres, buildings and all.' : 'The acres are not stated for sure, so no price per acre.'],
      ['Price per tillable acre', miss(NOT_REC), tillN],
      FL ? ['Qualification code', wait || gone || (flc ? esc((flc[1] === 'blank' ? 'None' : flc[1]) + ', ' + flc[2]) + (/^Qualified sale/.test(String(r.conv)) ? ': qualified sale' : ': not qualified') : miss(NOT_REC)),
        'The county property appraiser’s code on the sale. Codes 01 and 02 are qualified (arm’s length) sales; the others are listed and not counted.'] : null,
      FL ? null : ['Deed or conveyance type', wait || gone || (cf.deed ? esc(cf.deed) : miss(NOT_REC))],
      FL ? null : ['What the ' + T.form + ' says', wait || gone || (cf.flags.length ? cf.flags.map(function (w) { return esc(flagSentence(w)); }).join('<br>') : 'Nothing marked beyond the deed type.')],
      st === 'WI' ? ['Rights the seller keeps', fromRec('rr', function (v) { return esc(RR[v] || RR.other); })] : null,
      st === 'VT' ? ['Financing', fromRec('fin', function (v) { return esc(v); })] : null,
      st === 'IL' ? ['Personal property in the price', fromRec('pp', function (v) { return +v > 0 ? esc(money(+v)) + ' (taken out of the net price above)' : 'None'; })] : null,
      [T.doc, fromRec('doc', function (v) { return esc(v); })],
      FL ? null : [T.tax || 'Transfer tax', !T.tax ? miss(NOT_REC) : wait || gone || (rv('exempt') ? 'Exemption claimed' : 'No exemption claimed'), !T.tax ? 'Indiana’s form carries no transfer tax.' : null],
      FL ? ['Market sale', 'Yes, by the rule this site uses', 'The county property appraiser marked it qualified (code 01 or 02), with a price, acres and the whole interest. Taken from public records, not confirmed with the buyer or seller.']
        : ['Market sale', 'Yes, by the rule this site uses', 'A price, acres stated or several parcels, the whole interest and a normal deed: no gift, family or related-party sale, quit claim, court, foreclosure, trade or partition deed, and no tax exemption. Taken from public transfer records, not confirmed with the buyer or seller.']
    ]));
    /* the land */
    var cu = st === 'VT' ? (s.cu ? 'Yes' : 'No') : null;
    var bld = !T.bldg ? miss(NOT_REC) : wait || gone || (FLAG_BLDG(r) ? 'Yes: ' + esc(clsWords(r.cls, T.cls)) : 'None on the record');
    out.push(grp('Land', [
      ['Total acres', s.acres != null ? esc((Math.round(s.acres * 100) / 100).toLocaleString('en-US')) : miss('not stated for sure'),
        s.acres == null ? (rv('np') > 1 ? rv('np') + ' parcels on one ' + T.form + ' and the acres do not add up for sure.' : 'The record does not give the acres for sure.') : (st === 'NJ' ? 'Today’s lots on the 2026 assessment list, which may differ from the lots as sold.' : null)],
      has('ac1') && rv('ac1') != null ? ['First parcel, as written', esc(rv('ac1')) + ' acres', 'As the filer wrote it: often the whole sale, sometimes one parcel.'] : null,
      ['Tillable acres', miss(NOT_REC), tillN],
      ['Percent tillable', miss(NOT_REC)],
      ['Type', esc(KINDW[s.kind] || 'farmland')],
      ['Property class', fromRec('cls', function (v) { return esc(clsWords(v, T.cls)); })],
      FL ? ['Vacant or improved', wait || gone || (FLAG_BLDG(r) ? 'Improved: buildings on the land' : 'Vacant land'), 'As the Florida sale data file marks it, or an improved agricultural land use code.']
        : ['Buildings', bld, !T.bldg ? 'An Illinois declaration does not say whether buildings were included.' : null],
      st === 'NJ' ? ['Living space', fromRec('lsf', function (v) { return +v > 0 ? esc((+v).toLocaleString('en-US')) + ' square feet (main lot)' : 'None on the main lot'; })] : null,
      st === 'NJ' ? ['Year built', fromRec('yb', function (v) { return esc(v) + ' (main lot)'; }), 'Blank on the deed abstract when the lot has no house or the assessor left it out.'] : null,
      st === 'NJ' ? ['Assessed value, main lot', fromRec('avl', function (v) { return esc(money(+v)) + ' land' + (rv('avb') != null ? ', ' + esc(money(+rv('avb'))) + ' buildings' : '') + (rv('avy') ? ' (' + esc(rv('avy')) + ' tax list)' : ''); }), 'Farmland-assessed lots (3B) are valued on their farm use, far under a sale price.'] : null,
      st === 'VT' ? ['Town listed value', fromRec('glv', function (v) { return esc(money(+v)); }), 'The town grand list value on the return.'] : null,
      st === 'VT' ? ['Use before and after', fromRec('use0', function (v) { return 'Before the sale: ' + esc(useW(v)) + (rv('use1') ? '; the buyer\u2019s use: ' + esc(useW(rv('use1'))) : ''); })] : null,
      cu ? ['Current use', cu, 'Vermont’s use value program for farm and forest land.'] : null,
      st === 'WI' ? ['Managed forest acres', fromRec('mfl', function (v) { return esc(String(+v)) + ' acres'; }), 'Acres in Wisconsin’s Managed Forest Law program.'] : null,
      ['Parcels in the sale', wait || gone || esc(rv('np') || 1)]
    ]));
    /* where */
    /* a legal that names its own seller or buyer is not in the county file (scripts/land_names.py LEGAL_MARK): it comes
       with the names, on the tap (onTap fills span.ls-lgh) */
    var named = s.lx === 'h' || (r && /^\[LEGAL WITH A NAME /.test(String(r.legal || '')));
    var leg = r && rv('legal') && !named ? scrub(r.legal, s.lx, nf) : '';
    var legHtml = wait || gone || (named ? '<span class="ls-lgh" data-ls-id="' + esc(s.id) + '">' + miss('names a buyer or seller: shown with Show buyer and seller') + '</span>'
      : !has('legal') || !leg ? miss(NOT_REC) : leg.length > 70
      ? '<span class="ls-lg">' + esc(leg.slice(0, 70).replace(/\s+\S*$/, '')) + '&hellip;</span> <button type="button" class="ls-lgb" aria-expanded="false" data-full="' + esc(leg) + '">Show the whole description</button>'
      : esc(leg));
    var stk = rv('str');
    out.push(grp('Where', [
      [T.place, s.place ? esc(s.place) : wait || gone || (r && f && f.munis && r.muni != null && f.munis[String(r.muni)] ? esc(f.munis[String(r.muni)][0]) : miss(NOT_REC))],
      ['County', esc(s.county + ' County, ' + st)],
      ['Section, township, range', wait || gone || (stk ? esc(strWords(stk)) : miss(leg ? 'not readable from the legal description' : NOT_REC))],
      ['Legal description', legHtml, leg && leg.length >= 138 ? 'Our copy keeps the first 140 characters.' : null],
      [T.pid, fromRec('pid', function (v) { return esc(v); }), rv('np') > 1 ? 'The first parcel; the ' + T.form + ' lists ' + rv('np') + '.' : null],
      ['Street address', miss('left out'), 'An address can point at someone’s home, so it is not shown.']
    ]));
    /* how it compares */
    var u = s.u, cmp;
    if (!u) cmp = miss('no county middle: fewer than 5 bare farmland sales of 20 acres or more in 24 months');
    else if (s.ppa == null) cmp = 'Middle ' + esc(money(u[0])) + ' an acre on ' + u[3] + ' sales; this sale has no price per acre to set beside it.';
    else cmp = esc(money(s.ppa)) + ' an acre is ' + pct(s.ppa, u[0]) + ' the county middle of ' + esc(money(u[0])) + ' (' + u[3] + ' sales; middle half ' + esc(money(u[1])) + ' to ' + esc(money(u[2])) + ').';
    var win = s.w24 ? (T.month ? mon(s.w24[0]) + ' to ' + mon(s.w24[1]) : day(s.w24[0]) + ' to ' + day(s.w24[1])) : '24 months';
    out.push(grp('How it compares', [
      ['County middle, 24 months', cmp, 'Bare farmland sales of 20 acres or more at $500 an acre or more, ' + win + '.'],
      ['Counts toward the middle', s.m === 'y' ? (u ? 'Yes' : 'It qualifies, but the county has too few such sales for a middle') : MIDW[s.m] ? 'No: ' + esc(MIDW[s.m]) : miss('not figured')],
      ['Unusual price', s.flag === 1 ? 'Yes, well above the county’s usual' : s.flag === -1 ? 'Yes, well below the county’s usual' : 'No', s.flag ? 'Possible reasons are plain ones: buildings, timber or a neighbor paying more above; a family sale, poorer ground or a part interest below. The record does not say which.' : null]
    ]));
    /* source and names */
    var src = (f && f.source) || SRC[st] || 'The state transfer records';
    out.push('<h3 class="ls-dh">Source</h3><p class="ls-fine">' + esc(src) + (f && f.fetched_utc ? ', read ' + esc(day(String(f.fetched_utc).slice(0, 10))) : '') + '. A public record of one sale, not an appraisal.</p>');
    out.push('<h3 class="ls-dh">Buyer and seller</h3><p>' + (nf ? namesBtnHtml(s.id, nf) : miss(NOT_REC)) + '</p>');
    return out.join('');
  }
  var SRC = { IL: 'Illinois Department of Revenue, MyDec transfer declarations', IN: 'Indiana sales disclosure forms', WI: 'Wisconsin Department of Revenue, transfer returns',
    VT: 'Vermont property transfer tax returns', NJ: 'New Jersey deed abstracts (SR-1A) and the 2026 assessment list',
    FL: 'Florida Department of Revenue, sale data files and the assessment roll' };
  function useW(v) { return String(v).replace(/^\d+\.\s*/, ''); }
  function FLAG_BLDG(r) { return r && (/(^|[\s,;/])(1|2|3|7)($|[\s,;/])/.test(String(r.cls || '')) || /(^|; )with buildings(;|$)/.test(String(r.conv || ''))); }
  function strWords(k) {
    var m = /^(\d{1,2})-(\d{1,3})([NS?])-(\d{1,3})([EW?])(?:-(\d))?$/.exec(String(k || ''));
    if (!m) return String(k);
    return 'Section ' + m[1] + ', T' + m[2] + (m[3] === '?' ? '' : m[3]) + ', R' + m[4] + (m[5] === '?' ? '' : m[5])
      + (m[6] ? ', ' + ['', '', 'Second', 'Third', 'Fourth', 'Fifth'][+m[6]] + ' Principal Meridian' : '')
      + (m[3] === '?' || m[5] === '?' ? ' (the legal leaves out a direction)' : '');
  }

  /* an auction result (land_auctions.py): its tracts in words, the company's own per-acre range, and its panel. s.au = [company,
     result page, headline acres, total sold, [[tract label, sold, per acre], ...]] (a row's data-ls 'au', or the list file's au map;
     the list file's short form is [company, page, tract words]). Never a name: the source has none. */
  function tractWords(au) {
    if (au.length === 3) return au[2] || '';
    var T = au[4] || [], ps = T.map(function (t) { return t[2]; }).filter(function (v) { return v != null; });
    if (T.length < 2) return '';
    if (ps.length >= 2) return T.length + ' tracts, ' + money(Math.min.apply(null, ps)) + ' to ' + money(Math.max.apply(null, ps)) + ' an acre';
    return T.length + ' tracts, ' + (ps.length ? money(ps[0]) + ' an acre on one' : 'no per-acre figure printed');
  }
  /* a result page that more than one result of the page names is the company's whole list, not that result (rows on the page, and the list file's rows) */
  var AUURL = {};
  function urlShared(url) {
    var n = 0;
    Array.prototype.forEach.call(document.querySelectorAll('[data-ls]'), function (el) { var o = saleOf(el); if (o && o.au && o.au[1]) AUURL[o.id] = o.au[1]; });
    Object.keys(AUURL).forEach(function (k) { if (AUURL[k] === url) n++; });
    return n > 1;
  }
  function auctionPanel(s) {
    var au = s.au, T = au[4] || [], u = s.u, n = T.length, one = n === 1 ? T[0] : null;
    var link = au[1] && /^https?:\/\//.test(au[1]) ? '<a href="' + esc(au[1]) + '" rel="noopener nofollow">' + (urlShared(au[1]) ? 'Results list on ' : 'Result on ') + esc(au[0]) + '&rsquo;s site</a>' : '';
    var w = s.w24, inWin = !w || (s.when >= w[0] && s.when <= w[1]), small = au[2] != null && au[2] < 20;
    var basis = u ? (u[4] ? u[3] + ' auction per-acre figures from ' + u[4] + ' auctions' : u[3] + ' bare farmland sales') : '';
    var cmp = !inWin ? 'Not compared: auction day ' + esc(day(s.when)) + ' is ' + (s.when < w[0] ? 'older than' : 'after the end of') + ' the 24-month window the middle covers (' + esc(day(w[0]) + ' to ' + day(w[1])) + ').'
      : small ? 'Not compared: under 20 acres.'
      : !u ? miss('no county middle to set it beside') : s.ppa == null ? 'Middle ' + esc(money(u[0])) + ' an acre on ' + basis + '; this auction has no single price per acre to set beside it.'
      : esc(money(s.ppa)) + ' an acre is ' + pct(s.ppa, u[0]) + (u[4] ? ' the county\u2019s auction middle of ' : ' the county middle of ') + esc(money(u[0])) + ' (' + basis + '; middle half ' + esc(money(u[1])) + ' to ' + esc(money(u[2])) + ').';
    var nm = NAMES[s.st] || s.st, joint = one && /[+\-,]/.test(String(one[0]));
    var ppaNote = s.ppa != null ? (joint ? 'The company\u2019s own figure for tracts ' + String(one[0]) + ', sold together.' : 'The company\u2019s own figure.') : n > 1 ? 'The total is never divided by the headline acres here: the acres offered need not be the acres sold.' : null;
    var out = [];
    out.push(grp('Auction result', [
      ['What this is', 'An auction result reported by ' + esc(au[0]).replace(/\.$/, '') + '.', 'It is not a state transfer return: no recording, township, buyer or seller. The date is the auction day.'],
      ['Auction day', esc(day(s.when))],
      ['County', esc(s.county + ' County, ' + s.st)],
      ['Acres offered', au[2] != null ? esc(acres(au[2])) : miss('not stated by the company'), 'The company\u2019s headline acres; the acres sold may differ.'],
      ['Total sold', au[3] != null ? esc(money(au[3])) : miss('not published by the company')],
      ['Price per acre', s.ppa != null ? esc(money(s.ppa)) : n > 1 ? 'No single figure: each tract is listed below' : miss('not printed by the company'),
        ppaNote],
      ['Source', link || esc(au[0])]
    ]));
    if (n > 1 || (one && (one[1] != null || one[2] != null))) {
      var joint1 = T.some(function (t) { return /[+\-,]/.test(String(t[0])); });
      out.push(grp(n > 1 || joint1 ? 'Tracts' : 'Tract', T.map(function (t) {
        return [(/[+\-,]/.test(String(t[0])) ? 'Tracts ' : 'Tract ') + esc(t[0]), (t[1] != null ? esc(money(t[1])) + ' sold' : miss('sold figure not printed')) + ', ' + (t[2] != null ? esc(money(t[2])) + ' an acre' : miss('no per-acre figure'))];
      })));
    }
    out.push(grp('How it compares', [
      [u && u[4] ? 'Auction middle, 24 months' : 'County middle, 24 months', cmp, (u && u[4] ? 'From auction results only; no state transfer returns for ' + nm + ' are on this site yet. ' : 'From ' + nm + ' transfer returns only; auction results are not in it. ') + (w ? day(w[0]) + ' to ' + day(w[1]) : '24 months') + '.'],
      ['Unusual price', s.flag === 1 ? 'Yes, well above the county\u2019s usual' : s.flag === -1 ? 'Yes, well below the county\u2019s usual' : !inWin ? miss('not judged: outside those 24 months') : small ? miss('not judged: under 20 acres') : s.ppa == null ? miss('only an auction with one printed per-acre figure is judged') : 'No']
    ]));
    return out.join('');
  }

  function fill(p, s, nf) {
    if (s.au) { p.innerHTML = auctionPanel(s); return; }
    var base = HOST[s.st] || '/data/land/' + String(s.st).toLowerCase() + '/', url = base + s.fips + '.json';
    var key = ++seq;
    /* only a county file the builder found names-free (rec) is ever fetched: until a county's file is rewritten without
       its names, the panel shows what the page has and says the rest is not in our copy yet */
    if (!s.rec) { p.innerHTML = panelHtml(s, null, null, nf, 'later'); return; }
    p.setAttribute('data-k', key);
    p.innerHTML = panelHtml(s, null, null, nf, 'wait');
    p.setAttribute('aria-busy', 'true');
    get(url).then(function (f) {
      /* a split county (older years apart, "older"): a row past the recent years is in an older year's file; they load
         in order and their rows follow, so the row number counts across the whole county */
      if (!f || !f.older || !f.older.length || (s.ri != null && s.ri < (f.rows || []).length)) return f;
      return Promise.all(f.older.map(function (o) { return get(base + o.f); })).then(function (ps) {
        var g2 = {}; for (var k in f) if (k !== 'older') g2[k] = f[k];
        g2.rows = (f.rows || []).slice();
        ps.forEach(function (x) { g2.rows = g2.rows.concat((x && x.rows) || []); });
        return g2;
      });
    }).then(function (f) {
      if (+p.getAttribute('data-k') !== key) return;
      var r = f ? recOf(f, s, s.st) : null;
      var h = p.offsetHeight;
      p.style.minHeight = h + 'px';   /* the panel never shrinks once open: nothing under it jumps up */
      p.innerHTML = panelHtml(s, f, r, nf, f ? (r ? 'ok' : 'gone') : 'gone');
      p.removeAttribute('aria-busy');
      if (f && !r) p.insertAdjacentHTML('afterbegin', '<p class="ls-fine">The full record for this sale has moved in the newest county file; the rest is back after the next update.</p>');
    });
  }
  function toggle(b) {
    var host = b.closest('[data-ls]'), s = host ? saleOf(host) : null;
    if (!s) return;
    var open = b.getAttribute('aria-expanded') === 'true', id = b.getAttribute('aria-controls'), p = id ? document.getElementById(id) : null;
    if (open) { b.setAttribute('aria-expanded', 'false'); if (p) (p.closest('tr.ls-dr') || p).hidden = true; return; }
    b.setAttribute('aria-expanded', 'true');
    if (p) { (p.closest('tr.ls-dr') || p).hidden = false; return; }
    id = 'ls-dp-' + (++seq);
    b.setAttribute('aria-controls', id);
    var nb = host.querySelector('button.ls-nm'), nf = nb ? nb.getAttribute('data-ls-f') : null;
    p = document.createElement('div');
    p.className = 'ls-dp'; p.id = id; p.setAttribute('role', 'region'); p.tabIndex = -1; p.setAttribute('aria-label', 'Sale details, ' + when(s.when, s.st));
    if (host.tagName === 'TR') {
      var tr = document.createElement('tr'), td = document.createElement('td');
      tr.className = 'ls-dr'; td.colSpan = host.cells.length; td.appendChild(p); tr.appendChild(td);
      /* as wide as the scrolling table's window, not the table: no sideways scroll to read it on a phone */
      var wrap = host.closest('.ls-tw');
      if (wrap && wrap.clientWidth) p.style.maxWidth = Math.min(wrap.clientWidth, 736) + 'px';
      host.parentNode.insertBefore(tr, host.nextSibling);
    } else host.appendChild(p);
    fill(p, s, nf && /^\/data\/land\/names\//.test(nf) ? nf : null);
  }
  /* a row's date becomes the button that opens it (only once this script runs: no dead button without it) */
  function rowButtons(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('tr[data-ls]'), function (tr) {
      if (tr.querySelector('button.ls-dt') || !tr.cells.length) return;
      var td = tr.cells[0], t = td.textContent;
      td.innerHTML = '<button type="button" class="ls-dt" aria-expanded="false">' + esc(t) + '<span class="ls-sr"> sale details</span></button>';
    });
  }
  function onDetail(ev) {
    var t = ev.target && ev.target.closest ? ev.target : null;
    var b = t ? t.closest('button.ls-dt') : null;
    if (b) { toggle(b); return; }
    var lb = t ? t.closest('button.ls-lgb') : null;
    if (lb) {
      var sp = lb.previousElementSibling, open = lb.getAttribute('aria-expanded') === 'true';
      if (!lb._short) lb._short = sp.innerHTML;
      sp.innerHTML = open ? lb._short : esc(lb.getAttribute('data-full'));
      lb.setAttribute('aria-expanded', open ? 'false' : 'true');
      lb.textContent = open ? 'Show the whole description' : 'Show less';
    }
  }

  function scan() {
    css();
    rowButtons(document);
    Array.prototype.forEach.call(document.querySelectorAll('section[data-atlas-sales="county"]'), atlas);
    var am = /^\/farmland-atlas\/(indiana|vermont|new-jersey|florida)\//.exec(location.pathname);
    /* a state with no sales block of its own (Florida until its Atlas pages carry one): the box comes from #ch-live */
    if (am && !document.querySelector('section[data-atlas-sales="county"]')) { var cl = document.querySelector('#ch-live[data-st="' + ({ indiana: 'IN', vermont: 'VT', 'new-jersey': 'NJ', florida: 'FL' })[am[1]] + '"][data-fips]'); if (cl) atlas(cl); }
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
  document.addEventListener('click', onDetail);
  /* Escape closes the open panel the focus is in (or whose button has it) and puts the focus back on its button */
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
    var a = document.activeElement, p = a && a.closest ? a.closest('.ls-dp') : null, b = null;
    if (p) b = document.querySelector('button.ls-dt[aria-controls="' + p.id + '"]');
    else if (a && a.matches && a.matches('button.ls-dt[aria-expanded="true"]')) b = a;
    if (!b || b.getAttribute('aria-expanded') !== 'true') return;
    ev.preventDefault();
    toggle(b);
    try { b.focus(); } catch (e) {}
  });
  window.AgLandSales = { scan: scan, namesHtml: namesHtml, removeHref: removeHref, miles: miles, latestLine: latestLine, listRow: listRow, listRows: listRows,
    sha1: sha1, saleKey: saleKey, panelHtml: panelHtml, auctionPanel: auctionPanel, tractWords: tractWords, DCOLS: DCOLS };
  function ready() { scan(); watchNear(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
