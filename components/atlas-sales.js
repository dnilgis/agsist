/* Farmland Atlas: recorded farm sales (Oct 17, 2026), Illinois and Wisconsin only.

   Draws the "Recorded farm sales" block on the county pages, the compact block on the
   printable sheet (/farmland-atlas/sheet) and the county list on the state pages, from
   data/land/<st>/summary.json. scripts/build_land_summary.py computes every number in
   that file (counts, medians, middle half, the change, the range and the sales outside
   it) and withholds what it cannot stand behind; this file only words and draws them.

   No buyer or seller names, ever: atlas pages are indexed by search engines. Names stay
   on the Field Scout card for the one parcel a reader picks.

   The top half (AtlasSales) is plain functions with no page in them, so
   test/atlas-sales.test.mjs runs them in node. The bottom half mounts the blocks. */
(function (G) {
  'use strict';
  var S = {};
  S.STATES = { IL: 1, WI: 1 };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  S.esc = esc;
  S.money = function (x) { if (x == null || isNaN(x)) return ''; var v = Math.floor(Math.abs(x) + 0.5); return (x < 0 ? '-$' : '$') + v.toLocaleString('en-US'); };
  S.acres = function (a) { if (a == null) return 'unknown'; var r = Math.round(a * 10) / 10; return r.toLocaleString('en-US', { maximumFractionDigits: 1 }); };
  S.month = function (iso) { if (!iso) return ''; var m = +String(iso).slice(5, 7); return MON[m - 1] + ' ' + String(iso).slice(0, 4); };
  S.day = function (iso) { if (!iso) return ''; var m = +String(iso).slice(5, 7); return MON[m - 1] + ' ' + (+String(iso).slice(8, 10)) + ', ' + String(iso).slice(0, 4); };
  S.span = function (w) { return S.month(w[0]) + ' to ' + S.month(w[1]); };
  S.pct = function (x) { var t = (Math.round(Math.abs(x))).toString(); return (x > 0.5 ? '+' : x < -0.5 ? '-' : '') + t + '%'; };
  S.url = function (st) { return '/data/land/' + String(st).toLowerCase() + '/summary.json'; };

  // The sales median against the census value, said plainly: two different measures.
  S.compareText = function (c, census) {
    if (!census || census.v == null) return '';
    var t = 'USDA Census of Agriculture ' + census.year + ': ' + S.money(census.v) + ' an acre for land and buildings'
      + (census.flag ? ' (read with care, see Land value above)' : '') + '. ';
    t += 'That figure is what farm operators estimated all the county\'s farmland and buildings were worth, from a survey. '
      + 'The sales median is what buyers paid for the farms that sold, from the deed records. '
      + 'They measure different things and are not expected to match. Neither is an appraisal of any farm.';
    return t;
  };

  // Same rule as fact() in scripts/build_atlas_pages.py: a long row stacks (label over value).
  function fact(l, r, small, cls) {
    var long = String(r).replace(/<[^>]*>/g, '').length + String(small || '').length > 34 || String(l).length > 44;
    return '<div class="fact' + (cls ? ' ' + cls : '') + (long ? ' st' : '') + '"><span class="l">' + esc(l) + '</span><span class="r">' + r + (small ? '<small>' + esc(small) + '</small>' : '') + '</span></div>';
  }
  function saleTable(rows, withDir) {
    var h = '<div class="tw"><table class="as-t"><thead><tr><th scope="col">Date</th><th scope="col">Acres</th><th scope="col">Price</th><th scope="col">$/acre</th><th scope="col" class="as-wide">Township or town</th>'
      + (withDir ? '<th scope="col" class="as-wide">Against the middle range</th>' : '') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var dir = withDir ? (r[5] > 0 ? 'well above' : 'well below') : '';
      // on a phone the place (and how far out) go under the date instead of in columns of their own
      h += '<tr><td>' + esc(S.day(r[0])) + '<span class="as-tw">' + esc((r[4] || 'place not given') + (dir ? ', ' + dir : '')) + '</span></td><td>' + esc(S.acres(r[1])) + '</td><td>' + esc(S.money(r[2])) + '</td><td>' + esc(r[3] != null ? S.money(r[3]) : 'n/a') + '</td><td class="as-m as-wide">' + esc(r[4] || 'not given') + '</td>'
        + (withDir ? '<td class="as-m as-wide">' + dir + '</td>' : '') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  // The county block. sum = summary.json, f = county FIPS, census = {v, year, flag} from the page.
  S.countyHTML = function (sum, f, census) {
    var c = sum && sum.counties && sum.counties[f];
    var W = sum && sum.windows, N = (sum && sum.min_n) || 5, A = (sum && sum.min_acres) || 20;
    var src = sum ? '<a href="' + esc(sum.url) + '" target="_blank" rel="noopener">' + esc(sum.record) + '</a>, ' + esc(sum.who) : '';
    if (!c) return '<p class="note">No ' + esc(sum ? sum.record : 'transfer') + ' file is on hand for this county yet.</p>';
    var h = '';
    var lead = c.n12 + ' market farm sale' + (c.n12 === 1 ? ' was' : 's were') + ' recorded in ' + c.name + ' County from ' + S.span(W.cur);
    lead += c.n12p != null ? ', against ' + c.n12p + ' in the 12 months before.' : '.';
    h += '<p class="as-lead">' + esc(lead) + '</p>';
    h += fact('Market farm sales, ' + S.span(W.cur), esc(String(c.n12)), c.u12 ? 'acres unknown on ' + c.u12 + ' (a return covering several parcels)' : null);
    h += c.n12p != null ? fact('Market farm sales, ' + S.span(W.prev), esc(String(c.n12p)), c.u12p ? 'acres unknown on ' + c.u12p : null)
      : fact('Market farm sales, ' + S.span(W.prev), 'not shown', c.why_p || 'records do not reach back that far', 'w');
    if (c.med) {
      h += fact('Median price, sales of ' + A + '+ acres, ' + S.span(W.cur), esc(S.money(c.med.med)) + '/ac',
        c.med.n + ' sales with known acres; middle half ' + S.money(c.med.q1) + ' to ' + S.money(c.med.q3));
    } else {
      h += fact('Median price, sales of ' + A + '+ acres', 'not shown',
        'only ' + (c.k12 || 0) + ' sale' + (c.k12 === 1 ? '' : 's') + ' of ' + A + '+ acres with known acres in 12 months; a median needs ' + N + ' or more', 'w');
    }
    if (c.chg != null && c.medp) {
      h += fact('Change from the 12 months before', esc(S.pct(c.chg)), 'median ' + S.money(c.medp.med) + '/ac on ' + c.medp.n + ' sales, ' + S.span(W.prev));
    } else if (c.med) {
      var why = c.why_chg ? c.why_chg + ', so the two years do not compare'
        : (c.n12p == null ? (c.why_p || 'records do not reach back that far')
          : 'only ' + (c.k12p || 0) + ' sale' + (c.k12p === 1 ? '' : 's') + ' of ' + A + '+ acres with known acres in ' + S.span(W.prev) + '; needs ' + N);
      h += fact('Change from the 12 months before', 'not shown', why, 'w');
    }
    h += fact('Records', 'Filed ' + esc(S.month(c.from)) + ' to ' + esc(S.month(c.to)), null);
    h += '<p class="note">Source: ' + src + '. Sales dated through ' + esc(S.day(sum.through)) + '; the latest weeks can still be filling in as deeds are recorded. ' + esc(sum.since_note || '') + '</p>';
    var cmp = S.compareText(c, census);
    if (cmp && c.med) h += '<p class="warn as-cmp">' + esc(cmp) + '</p>';

    // large and unusual
    h += '<h3 class="as-h">Large and unusual sales, ' + esc(S.span(W.w24)) + '</h3>';
    if (c.large && c.large.length) {
      h += '<p class="note">The largest market sales by acres, of ' + c.a24 + ' with known acres.</p>' + saleTable(c.large, false);
    } else {
      h += '<p class="note">Not shown: ' + (c.a24 || 0) + ' market sale' + (c.a24 === 1 ? '' : 's') + ' with known acres in 24 months, under the ' + N + ' it takes to call any of them large for the county.</p>';
    }
    if (c.r24) {
      var r = c.r24;
      if (c.out && c.out.length) {
        h += '<p class="note">Sales whose $/acre is well outside the county\'s middle range. Of ' + r.n + ' sales of ' + A + '+ acres with known acres, the middle half sold for '
          + esc(S.money(r.q1)) + ' to ' + esc(S.money(r.q3)) + ' an acre; "well outside" means ' + (r.lo > 0 ? 'under ' + esc(S.money(r.lo)) + ' or over ' : 'over ') + esc(S.money(r.hi))
          + (r.lo > 0 ? ' (one and a half times the width of the middle half past either end).' : ' (one and a half times the width of the middle half past the top; the low side reaches below $0, so no sale is low enough).')
          + (c.nout > c.out.length ? ' The ' + c.out.length + ' farthest out of ' + c.nout + ' are shown.' : '') + '</p>';
        h += saleTable(c.out, true);
        h += '<p class="note">The record does not say why a price sits far from the rest. Buildings, a house, a building site, land bought for development, a neighbor who had to have it or a sale that was not quite what the deed type says can all do it.</p>';
      } else {
        h += '<p class="note">No sale was well outside the county\'s middle range (' + esc(S.money(r.q1)) + ' to ' + esc(S.money(r.q3)) + ' an acre, from ' + r.n + ' sales of ' + A + '+ acres).</p>';
      }
    } else {
      h += '<p class="note">No sale is called unusual: ' + (c.k24 || 0) + ' sale' + (c.k24 === 1 ? '' : 's') + ' of ' + A + '+ acres with known acres in 24 months, and it takes ' + N + ' to set a usual range.</p>';
    }
    h += '<p class="note">Buyer and seller names are not shown on the Atlas. For one field\'s own transfer record, pick it in <a href="/field-scout">Field Scout</a>.</p>';
    h += '<details class="as-d"><summary>How these are counted</summary><p class="note">'
      + 'A market sale has a price, is not exempt from the state transfer fee, and has a deed type that normally carries a market price: '
      + 'related-party sales, quit claims, gifts, sheriff, judicial, court and partition deeds are left out. '
      + esc(sum.state === 'WI' ? 'Wisconsin returns here are the ' + sum.kinds + '.' : 'Illinois declarations here are ' + sum.kinds + '.') + ' '
      + 'Acres on a return that covers several parcels count only when every parcel gives them in acres; otherwise acres are unknown and the sale gives no $/acre. '
      + 'A sale of ' + A + ' acres or more with known acres counts toward the median, sold with or without buildings. '
      + 'The middle half runs from the 25th to the 75th percentile, linear between ranks. Under ' + N + ' sales nothing is shown. '
      + 'The change is shown only when both years have ' + N + ' or more such sales and acres are known on at least 3 in 4 market sales in each. '
      + 'Dates are sale dates on the return.</p></details>';
    return h;
  };

  // Compact block for the printable sheet, in the sheet's own row markup.
  S.sheetHTML = function (sum, f, fct, fw) {
    var c = sum && sum.counties && sum.counties[f];
    if (!c) return '';
    var W = sum.windows, N = sum.min_n || 5, A = sum.min_acres || 20;
    var h = '<h2>Recorded farm sales</h2>';
    h += fct('Market sales, ' + S.span(W.cur), String(c.n12), (c.n12p != null ? c.n12p + ' the 12 months before' : '') + (c.u12 ? (c.n12p != null ? '; ' : '') + 'acres unknown on ' + c.u12 : ''));
    if (c.med) h += fct('Median, ' + A + '+ acre sales', S.money(c.med.med) + '/ac', c.med.n + ' sales; middle half ' + S.money(c.med.q1) + ' to ' + S.money(c.med.q3));
    else h += fw('Median, ' + A + '+ acre sales', 'not shown: ' + (c.k12 || 0) + ' sales, needs ' + N);
    if (c.chg != null && c.medp) h += fct('Change from the year before', S.pct(c.chg), 'from ' + S.money(c.medp.med) + '/ac, ' + c.medp.n + ' sales');
    if (c.large && c.large.length) {
      var L = c.large[0];
      h += fct('Largest sale by acres, 24 months', S.acres(L[1]) + ' ac', S.month(L[0]) + ', ' + S.money(L[2]) + (L[3] != null ? ', ' + S.money(L[3]) + '/ac' : '') + (L[4] ? ', ' + L[4] : ''));
    }
    if (c.r24) {
      h += fct('Unusual $/acre, 24 months', String(c.nout || 0) + ' of ' + c.r24.n, 'sales of ' + A + '+ ac well outside the middle half, ' + S.money(c.r24.q1) + ' to ' + S.money(c.r24.q3));
      if (c.out && c.out.length) {
        var O = c.out[0];
        h += fct('Farthest out', S.money(O[3]) + '/ac', S.month(O[0]) + ', ' + S.acres(O[1]) + ' ac, ' + S.money(O[2]) + (O[4] ? ', ' + O[4] : '') + ', ' + (O[5] > 0 ? 'well above' : 'well below') + ' the middle range');
      }
    }
    h += '<p class="note">Market sales only: related-party sales, quit claims, gifts, sheriff, judicial, court and partition deeds are left out. '
      + esc(sum.record) + ' (' + esc(sum.who) + '), filed ' + esc(S.month(c.from)) + ' to ' + esc(S.month(c.to)) + '; sales dated through ' + esc(S.day(sum.through)) + '. '
      + 'Prices buyers paid, not the census estimate above. No names printed.</p>';
    return h;
  };

  // The state list: one row per county, the median from sales. urls = {fips: page url}.
  S.stateHTML = function (sum, urls) {
    if (!sum || !sum.counties) return '<p class="note">The sales file did not load. Try again in a minute.</p>';
    var W = sum.windows, A = sum.min_acres || 20, N = sum.min_n || 5;
    var ks = Object.keys(sum.counties).sort(function (a, b) { return sum.counties[a].name < sum.counties[b].name ? -1 : 1; });
    var h = '';
    if (sum.state_med) h += '<p class="as-lead">Statewide, ' + esc(S.span(W.cur)) + ': median ' + esc(S.money(sum.state_med.med)) + ' an acre on ' + sum.state_med.n.toLocaleString('en-US') + ' market sales of ' + A + '+ acres with known acres (middle half ' + esc(S.money(sum.state_med.q1)) + ' to ' + esc(S.money(sum.state_med.q3)) + ').</p>';
    h += '<div class="tw"><table class="as-t"><thead><tr><th scope="col">County</th><th scope="col">Median $/acre</th><th scope="col" class="as-wide">Middle half</th><th scope="col">Sales</th></tr></thead><tbody>';
    ks.forEach(function (f) {
      var c = sum.counties[f], u = urls && urls[f];
      var nm = u ? '<a href="' + esc(u) + '">' + esc(c.name) + '</a>' : esc(c.name);
      h += '<tr><td>' + nm + '</td>' + (c.med ? '<td>' + esc(S.money(c.med.med)) + '</td><td class="as-wide">' + esc(S.money(c.med.q1)) + ' to ' + esc(S.money(c.med.q3)) + '</td><td>' + c.med.n + '</td>'
        : '<td>not shown</td><td class="as-wide">under ' + N + ' sales</td><td>' + (c.k12 || 0) + '</td>') + '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="note">Market farm sales of ' + A + '+ acres with known acres, dated ' + esc(S.span(W.cur)) + ', from <a href="' + esc(sum.url) + '" target="_blank" rel="noopener">' + esc(sum.record) + '</a>. '
      + 'Prices buyers paid, not the USDA survey or census estimates elsewhere on this page. Under ' + N + ' sales, no median.</p>';
    return h;
  };

  // ── on the page ────────────────────────────────────────────────────
  var CSS = '.as-lead{font-size:.95rem;line-height:1.6;margin:.2rem 0 .6rem;max-width:75ch}'
    + '.as-h{font-family:var(--font-mono);font-size:.74rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin:1.2rem 0 .4rem}'
    + '.as-t td.as-m{font-family:inherit;white-space:normal;text-align:left}.as-t th:nth-child(5),.as-t th:nth-child(6){text-align:left}'
    + '.as-tw{display:none}@media (max-width:600px){.as-t .as-wide{display:none}.as-tw{display:block;font-size:.74rem;color:var(--text-muted);white-space:normal}.as-t td,.as-t th{padding-left:.25rem;padding-right:.25rem}}'
    + '.as-d summary{cursor:pointer;font-size:.85rem;color:var(--text-dim);margin:.4rem 0}.as-cmp{max-width:75ch}'
    + '.as-go{font:inherit;font-size:.85rem;font-weight:700;color:var(--text);background:var(--surface,#12161a);border:1px solid var(--border);border-radius:8px;padding:.5rem .85rem;min-height:40px;cursor:pointer}';
  function style(d) { if (d.getElementById('as-css')) return; var s = d.createElement('style'); s.id = 'as-css'; s.textContent = CSS; d.head.appendChild(s); }
  var cache = {};
  S.load = function (st) {
    st = String(st).toUpperCase();
    if (!cache[st]) cache[st] = fetch(S.url(st), { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return cache[st];
  };
  function census() {
    try { var r = JSON.parse(document.getElementById('rec').textContent); return { v: r.value_usd_ac, year: r.value_year, flag: !!r.value_flag }; } catch (e) { return null; }
  }
  function mount(el) {
    var st = el.getAttribute('data-st'), f = el.getAttribute('data-fips'), mode = el.getAttribute('data-atlas-sales');
    var box = el.querySelector('.as-body') || el;
    if (mode === 'state') {
      var b = el.querySelector('.as-go');
      if (!b) return;
      b.addEventListener('click', function () {
        b.disabled = true; b.textContent = 'Loading...';
        S.load(st).then(function (sum) {
          var urls = null; try { urls = JSON.parse(el.querySelector('.as-urls').textContent); } catch (e) {}
          box.innerHTML = S.stateHTML(sum, urls); b.remove();
          try { G.gaEvent && G.gaEvent('atlas_state_sales', { st: st }); } catch (e) {}
        });
      });
      return;
    }
    var go = function () {
      S.load(st).then(function (sum) {
        box.innerHTML = sum ? S.countyHTML(sum, f, census()) : '<p class="note">The sales file did not load. Reload the page in a minute.</p>';
        el.setAttribute('data-ready', '1');
      });
    };
    if ('IntersectionObserver' in G) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); go(); } }, { rootMargin: '600px 0px' });
      io.observe(el);
    } else go();
  }
  S.mountAll = function () {
    style(document);
    Array.prototype.forEach.call(document.querySelectorAll('[data-atlas-sales]'), mount);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else {
    G.AtlasSales = S;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', S.mountAll); else S.mountAll();
  }
})(typeof window !== 'undefined' ? window : globalThis);
