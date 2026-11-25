/* components/prf-county.js: the county view on each PRF state page (prf/<state>.html), Nov 2026.

   WHAT IT SHOWS, for the county a reader picks: the labeled 100-acre example,
   USDA's county base values, what each pair of months costs at 90% coverage
   and how often it came in under 90% of normal since 1951, the last five years
   and this year so far, and every grid that touches the county with its
   record. These are the figures the old county pages printed, laid out the
   same way; the county pages now forward here.

   DATA: /prf/<state>/<county>.json (scripts/build_prf_counties.py view()),
   fetched when a county is picked. Every number arrives rounded the way the
   page prints it, so this file formats and never rounds.

   WIRING: <section id="county" data-prf-county data-state="iowa"> holds a
   [data-pc-pick] slot (the picker is built here from the county table's
   links (a[data-c], under #counties), so the list is not in the page twice) and a
   [data-pc-body] slot for the view. A county comes from ?county=<slug> (the
   old county addresses forward with it) or #county=<slug> (the table's links).
   On each pick it sends `prf:grid` (detail { grid, st }) so the "This interval
   so far" card (components/prf-now.js) and the grid email (prf-notice.js)
   follow the county's grid, and fills the card's grid picker.

   PRF RULE: the page stays neutral. No buying words, no agent, no pick.
   Pure functions are on window.AgPrfCounty (test/prf-county-fold.test.mjs). No em dashes. */
(function (root) {
  'use strict';

  var SHORT = ['Jan-Feb', 'Feb-Mar', 'Mar-Apr', 'Apr-May', 'May-Jun', 'Jun-Jul', 'Jul-Aug', 'Aug-Sep', 'Sep-Oct', 'Oct-Nov', 'Nov-Dec'];
  var LONG = ['January to February', 'February to March', 'March to April', 'April to May', 'May to June', 'June to July',
    'July to August', 'August to September', 'September to October', 'October to November', 'November to December'];
  var MAX_GRID_ROWS = 30;
  var DASH = '&mdash;';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
  function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* "$1,234.56"; the builder already rounded to cents */
  function money2(x) {
    if (x === null || x === undefined) return DASH;
    var neg = x < 0, s = Math.abs(x).toFixed(2), i = s.indexOf('.');
    return (neg ? '-' : '') + '$' + commas(s.slice(0, i)) + s.slice(i);
  }
  /* "$1,234"; the builder already rounded to whole dollars */
  function dollars(x) { return '$' + commas(Math.round(x)); }
  function fix(x, d) { return Number(x).toFixed(d); }

  function rng(r, f) {
    if (!r) return DASH;
    if (r[0] === r[2]) return f(r[1]);
    return f(r[1]) + '<br><span class="prf-th-s">' + f(r[0]) + '&ndash;' + f(r[2]).replace(/^\$/, '') + '</span>';
  }
  function pctCell(v) {
    if (v === null || v === undefined) return '<td>' + DASH + '</td>';
    return '<td' + (v < 90 ? ' class="is-pay"' : '') + '>' + v + '</td>';
  }

  /* The average set against the full premium, not only the farmer's share. */
  function vsPremium(ex) {
    var avg = ex.avg, prem = ex.premium, you = ex.you;
    if (avg < prem) {
      if (avg > you) return 'That average is under the full premium of ' + dollars(prem) + '; it comes out above your share only because USDA pays the rest. ';
      return 'That average is under the full premium of ' + dollars(prem) + ', and under your share too, even with USDA paying the rest. ';
    }
    return 'That average is at or above the full premium of ' + dollars(prem) + ', so it covered the whole premium; on your share it looks better still only because USDA pays the rest. ';
  }
  function example(d) {
    var ex = d.ex;
    if (!ex) {
      return '<p class="prf-note prf-ex"><b>Example:</b> the calculator opens on April to May and June to July, and this county ' +
        'does not offer both for grazing, so no example is priced here. The calculator prices the months it does offer.</p>';
    }
    var where = ex.of > 1 ? 'grid ' + ex.grid + ', the middle of the county&rsquo;s ' + ex.of + ' grids by premium' : 'grid ' + ex.grid;
    var when = d.read ? ' (USDA files read ' + esc(d.read) + ')' : '';
    return '<p class="prf-note prf-ex"><b>What it costs here at ' + d.cy + ' rates' + when + ':</b> you pay ' + dollars(ex.you) + ' a year, ' +
      '$' + fix(ex.you_acre, 2) + ' an acre, for 100 acres of grazing at 90% coverage, productivity factor 100, half in April to May and half in June to July, ' +
      'on ' + where + '. USDA pays ' + dollars(ex.usda) + ' of the ' + dollars(ex.premium) + ' full premium. Run over ' + d.y0 + ' to ' + d.y1 + ' at ' + d.cy + ' rates, it would have paid in ' +
      ex.paid + ' of ' + ex.years + ' years, an average of ' + dollars(ex.avg) + ' a year, or $' + fix(ex.avg_acre, 2) + ' an acre. ' +
      vsPremium(ex) + 'That is the past record, not a forecast, and it leaves out the administrative fee. Example, not a recommendation.</p>';
  }

  /* The county view, as HTML. d is one /prf/<state>/<county>.json. */
  function render(d) {
    var name = esc(d.name), full = esc(d.name + ', ' + d.state);
    var grids = d.grids || [], ng = grids.length, many = ng > 1;
    var calc = '/prf?c=' + d.fips;
    var subrow = Object.keys(d.sub).sort(function (a, b) { return a - b; }).map(function (k) { return d.sub[k] + '% at ' + k + '%'; }).join(', ');
    var allN = d.iv.every(function (r) { return !r.n || r.n === ng; });
    var midWord = many ? 'the middle of the ' + ng + ' grids' : 'the grid';

    var ivRows = d.iv.map(function (r, i) {
      var few = (many && r.n && r.n < ng) ? '<br><span class="prf-th-s">' + r.n + ' of ' + ng + ' grids</span>' : '';
      return '<tr><th scope="row"><abbr title="' + LONG[i] + '">' + SHORT[i] + '</abbr>' + few + '</th>' +
        '<td>' + (r['in'] !== null ? fix(r['in'], 2) + ' in' : DASH) + '</td>' +
        '<td>' + rng(r.rate, money2) + '</td><td>' + rng(r.below, String) + '</td></tr>';
    }).join('');

    var rec = d.rec || [];
    var yrHead = rec.map(function (x) { return '<th scope="col">' + x.y + (x.open ? '<br><span class="prf-th-s">so far</span>' : '') + '</th>'; }).join('');
    var yrRows = '';
    for (var i = 0; i < 11; i++) yrRows += '<tr><th scope="row">' + SHORT[i] + '</th>' + rec.map(function (x) { return pctCell(x.iv[i]); }).join('') + '</tr>';
    var openY = null;
    rec.forEach(function (x) { if (x.open && !openY) openY = x; });
    var openN = openY ? openY.iv.filter(function (v) { return v !== null && v !== undefined; }).length : 0;

    var gRows = d.gr.slice(0, MAX_GRID_ROWS).map(function (g) {
      return '<tr><th scope="row">' + g[0] + '</th>' +
        '<td>' + (g[1] !== null ? fix(g[1], 1) + ' in' : DASH) + '</td>' +
        '<td>' + (g[2] ? g[2] + ', ' + g[3] + '%' : DASH) + '</td>' +
        '<td>' + (g[4] !== null ? g[4] + '%' : DASH) + '</td>' +
        '<td>' + (g[5] !== null ? g[5] : DASH) + '</td>' +
        '<td><a href="/prf?g=' + g[0] + '&amp;c=' + d.fips + '" rel="nofollow">Open</a></td></tr>';
    }).join('');
    var rest = d.gr.slice(MAX_GRID_ROWS);
    var restTxt = rest.length ? '<p class="prf-fine">And ' + rest.length + ' more grids: ' + rest.map(function (g) { return g[0]; }).join(', ') +
      '. Each opens in the <a href="' + calc + '" rel="nofollow">calculator</a>.</p>' : '';

    /* figures for the prose */
    var cheap = null, dear = null, wet = null, dry = null;
    d.iv.forEach(function (r, i) {
      if (r.rate) {
        if (!cheap || r.rate[1] < cheap[1]) cheap = [i, r.rate[1]];
        if (!dear || r.rate[1] > dear[1]) dear = [i, r.rate[1]];
      }
      if (r['in'] !== null) {
        if (!wet || r['in'] > wet[1]) wet = [i, r['in']];
        if (!dry || r['in'] < dry[1]) dry = [i, r['in']];
      }
    });
    var dryYears = [];
    d.gr.forEach(function (g) { if (g[2] && dryYears.indexOf(g[2]) < 0) dryYears.push(g[2]); });

    var lead = many && allN
      ? ', across the ' + ng + ' grids that touch the county: first the middle of the ' + ng + ' for that pair of months (it can be a different grid in each row), then the lowest and highest'
      : many ? ', across the grids that touch the county that price each pair of months (' + ng + ' in all; a row priced on fewer says how many): first the middle grid for that pair of months (it can be a different grid in each row), then the lowest and highest'
        : '';
    var prose = (wet && dry ? 'The wettest pair of months here is ' + LONG[wet[0]] + ' (' + fix(wet[1], 2) + ' in on ' + midWord + ') and the driest is ' + LONG[dry[0]] + ' (' + fix(dry[1], 2) + ' in). ' : '') +
      (cheap && dear && cheap[0] !== dear[0] ? 'Coverage costs least in ' + LONG[cheap[0]] + ' and most in ' + LONG[dear[0]] + '. ' : '') +
      'The months to insure are the ones when a dry spell costs you grass or hay, not the cheapest ones.';
    var irrLow = (d.hi !== null && d.hy !== null && d.hi < d.hy) ? ' USDA sets irrigated hay lower here.' : '';
    var more = (d.links || []).map(function (l) { return '<a href="' + esc(l[1]) + '">' + esc(l[0]) + '</a>'; }).join(' &middot; ');

    return '<div class="prf-cp" data-fips="' + d.fips + '">' +
      '<h3 class="prf-cp-h" tabindex="-1">PRF in ' + full + '</h3>' +
      '<p class="prf-fine">USDA&rsquo;s ' + d.cy + ' files offer PRF in ' + name + ' on ' + (ng === 1 ? 'grid ' + grids[0] : ng + ' grids, each in the table of grids below') + '.</p>' +
      example(d) +
      '<p><a class="btn btn-primary prf-cta" href="' + calc + '" rel="nofollow">Open the PRF calculator on ' + name + '</a></p>' +
      '<dl class="prf-figs prf-st-figs">' +
      '<div><dt>Grids</dt><dd>' + ng + '</dd></div>' +
      '<div><dt>Grazing, county base value per acre</dt><dd>' + money2(d.gz) + '</dd></div>' +
      '<div><dt>Hay, non-irrigated, per acre</dt><dd>' + money2(d.hy) + '</dd></div>' +
      '<div><dt>Hay, irrigated, per acre</dt><dd>' + money2(d.hi) + '</dd></div>' +
      '<div><dt>January to February cap</dt><dd>' + esc(d.jf) + '</dd></div></dl>' +
      '<p class="prf-fine">USDA&rsquo;s ' + d.cy + ' county base values, the same on every grid in the county. Protection per acre is the value times your coverage level times a productivity factor of 60 to 150: grazing at 90% and 100 is ' + money2(d.prot) + ' an acre.' + irrLow + '</p>' +
      '<div class="prf-prose">' +
      '<h4 class="prf-cp-s">What each pair of months costs in ' + name + '</h4>' +
      '<p>At 90% coverage' + lead + '. The premium is the full rate per $100 of protection; USDA pays ' + subrow + '. Normal is the grid&rsquo;s average precipitation for those months. A year counts, of the ' + d.ny + ' from ' + d.y0 + ' to ' + d.y1 + ', when the grid&rsquo;s index for those months came in under 90% of normal, which is when a 90% policy pays.</p>' +
      '<div class="prf-scroll" tabindex="0" role="region" aria-label="Each pair of months in ' + name + ', scrolls sideways"><table class="prf-t prf-sub-t prf-iv-t"><caption class="prf-sr">Each pair of months in ' + full + ' at 90% coverage</caption><thead><tr><th scope="col">Months</th><th scope="col">Normal</th><th scope="col">Premium per $100</th><th scope="col">Years under 90%</th></tr></thead><tbody>' + ivRows + '</tbody></table></div>' +
      '<p>' + prose + '</p>' +
      '<h4 class="prf-cp-s">The last five years in ' + name + (d.open ? ', and ' + d.open + ' so far' : '') + '</h4>' +
      (d.story || '') +
      '<p>The index for each pair of months as a percent of normal (100 is a normal year), on ' + midWord + (many ? ' (each grid has its own; the calculator shows yours)' : '') + '. Shaded cells came in under 90%, where a 90% policy on those months would have paid.' + (openY ? ' ' + d.open + ' shows the ' + openN + ' pairs of months USDA has published so far.' : '') + '</p>' +
      (rec.length ? '<div class="prf-scroll" tabindex="0" role="region" aria-label="Recent years in ' + name + ', scrolls sideways"><table class="prf-t prf-yr-t"><caption class="prf-sr">PRF index by pair of months, ' + rec[0].y + ' to ' + rec[rec.length - 1].y + ', ' + full + '</caption><thead><tr><th scope="col">Months</th>' + yrHead + '</tr></thead><tbody>' + yrRows + '</tbody></table></div>' : '') +
      '<p class="prf-fine">Every year since ' + d.y0 + ', priced at ' + d.cy + ' rates, is in the <a href="' + calc + '" rel="nofollow">calculator</a>.</p>' +
      '<h4 class="prf-cp-s">PRF ' + (many ? 'grids' : 'grid') + ' in ' + name + '</h4>' +
      '<p>Each grid&rsquo;s normal precipitation over a year, its driest year since ' + d.y0 + ' as a percent of normal, ' + d.y1 + ' as a percent of normal, and how many of ' + d.ny + ' years as a whole came in under 90%.' + (dryYears.length === 1 ? ' The driest year on the record here was ' + dryYears[0] + '.' : '') + '</p>' +
      '<div class="prf-scroll" tabindex="0" role="region" aria-label="Every grid in ' + name + ', scrolls sideways"><table class="prf-t prf-co-t"><caption class="prf-sr">PRF grids in ' + full + '</caption><thead><tr><th scope="col">Grid</th><th scope="col">Normal, year</th><th scope="col">Driest year</th><th scope="col">' + d.y1 + '</th><th scope="col">Years under 90%</th><th scope="col"><span class="prf-sr">Calculator</span></th></tr></thead><tbody>' + gRows + '</tbody></table></div>' +
      restTxt + '</div>' +
      (more ? '<p class="prf-fine">' + more + '</p>' : '') +
      '</div>';
  }

  /* ?county=<slug> or #county=<slug>; anything else is no county */
  function pickFrom(search, hash) {
    var m = /[?&]county=([a-z0-9-]+)/.exec(search || '') || /^#county=([a-z0-9-]+)$/.exec(hash || '');
    return m ? m[1] : '';
  }

  var api = { render: render, pickFrom: pickFrom, money2: money2, dollars: dollars };
  root.AgPrfCounty = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  var CSS = '.prf-county{margin:1.4rem 0;padding:1rem 1.1rem;border:1px solid var(--border,#333);border-radius:var(--r-lg);background:var(--surface,transparent)}' +
    '.prf-county>h2{margin:0 0 .35rem}.pc-pick{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .6rem;margin:.4rem 0 .2rem}' +
    '.prf-county{scroll-margin-top:84px}.pc-pick label{font-weight:600}.pc-pick select{width:min(100%,24rem);min-width:0;font:inherit;padding:.4rem .5rem;border-radius:var(--r-md)}' +
    '.prf-cp{margin-top:1rem;padding-top:.8rem;border-top:1px solid var(--border,#333)}.prf-cp-h{margin:0 0 .4rem;font-size:1.2rem}' +
    '.prf-cp-h:focus{outline:none}.prf-cp-s{margin:1.2rem 0 .4rem;font-size:1.05rem}.pc-held{font-size:.9rem;color:var(--text-muted,#999)}';

  var docs = {};
  function load(st, slug) {
    var url = '/prf/' + st + '/' + slug + '.json';
    if (!docs[url]) docs[url] = fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return docs[url];
  }

  function start() {
    var sec = document.querySelector('[data-prf-county]');
    if (!sec) return;
    if (!document.getElementById('prf-county-css')) {
      var s = document.createElement('style'); s.id = 'prf-county-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    var st = sec.getAttribute('data-state');
    var body = sec.querySelector('[data-pc-body]');
    var slot = sec.querySelector('[data-pc-pick]');
    var links = Array.prototype.slice.call(document.querySelectorAll('a[data-c]'));
    if (!st || !body || !slot || !links.length) return;
    var names = {};
    var sel = document.createElement('select');
    sel.id = 'prf-county-pick';
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Pick a county'; sel.appendChild(o0);
    links.forEach(function (a) {
      var c = a.getAttribute('data-c');
      names[c] = a.textContent;
      var o = document.createElement('option'); o.value = c; o.textContent = a.textContent; sel.appendChild(o);
    });
    var lab = document.createElement('label'); lab.htmlFor = 'prf-county-pick'; lab.textContent = 'County';
    slot.appendChild(lab); slot.appendChild(sel); slot.hidden = false;

    /* the "This interval so far" card's grid picker, filled for the county */
    var nowSec = document.getElementById('prf-now');
    function nowGrids(d) {
      if (!nowSec) return;
      var pick = nowSec.querySelector('[data-pn-pick]');
      if (pick) {
        pick.textContent = '';
        if (d.grids.length > 1) {
          var gs = document.createElement('select'); gs.id = 'prf-now-grid';
          d.grids.forEach(function (g) { var o = document.createElement('option'); o.value = g; o.textContent = 'Grid ' + g; gs.appendChild(o); });
          gs.value = String(d.now);
          var gl = document.createElement('label'); gl.htmlFor = 'prf-now-grid'; gl.textContent = 'Your grid';
          pick.appendChild(gl); pick.appendChild(gs); pick.hidden = false;
          gs.addEventListener('change', function () {
            document.dispatchEvent(new CustomEvent('prf:grid', { detail: { grid: +gs.value, st: d.st } }));
          });
        } else pick.hidden = true;
      }
      var sub = nowSec.querySelector('.pn-sub');
      if (sub) sub.textContent = 'Where ' + (d.grids.length > 1 ? 'a grid in ' : 'the grid in ') + d.name + ' stands in the pairs of months still open, before RMA’s final index. Preliminary.';
      document.dispatchEvent(new CustomEvent('prf:grid', { detail: { grid: d.now, st: d.st } }));
    }

    var cur = '';
    function show(slug, focus) {
      if (!slug || !names[slug]) { cur = ''; sel.value = ''; return; }
      if (slug === cur) { if (focus) sec.scrollIntoView(); return; }
      cur = slug; sel.value = slug;
      body.innerHTML = '<p class="pc-held">Loading ' + esc(names[slug]) + '&hellip;</p>';
      load(st, slug).then(function (d) {
        if (cur !== slug) return;
        if (!d || d.v !== 1) {
          body.innerHTML = '<p class="pc-held">' + esc(names[slug]) + ' did not load. Try again, or open the <a href="/prf">PRF calculator</a>, which has every county.</p>';
          return;
        }
        body.innerHTML = render(d);
        nowGrids(d);
        if (focus) {
          var h = body.querySelector('.prf-cp-h');
          sec.scrollIntoView();
          if (h && h.focus) h.focus({ preventScroll: true });
        }
      });
    }
    sel.addEventListener('change', function () {
      if (history.replaceState) history.replaceState(null, '', location.pathname + (sel.value ? '#county=' + sel.value : ''));
      show(sel.value, false);
    });
    window.addEventListener('hashchange', function () { var c = pickFrom('', location.hash); if (c) show(c, true); });
    show(pickFrom(location.search, location.hash), true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
