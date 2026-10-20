/* components/prf-outlook.js: the "Long-range outlook" panel on /prf.

   WHAT IT SHOWS, for the grid the reader has found
     * the ENSO alert in one line (CPC's ENSO Diagnostic Discussion)
     * for each PRF interval of the crop year: what CPC's seasonal outlook says
       about precipitation for the 3-month seasons that contain it
     * CPC's one-month outlook for the next month, labelled as one month
     * the US Drought Monitor category at the grid's center
     * what an outlook is and is not, and links to the sources

   WHAT IT WILL NOT SAY
     * a "best" interval, or which months to insure. The page is neutral.
     * a number for two months that CPC did not publish. Every PRF interval
       sits inside two overlapping CPC seasons (Jan-Feb is in Dec-Feb and in
       Jan-Mar). When both say the same, that is shown once; when they differ,
       both are shown and the panel says CPC gives no figure for the two months
       alone; when only one is issued, it says so.
     * anything from a section past its age limit. CPC issues seasonal
       outlooks on the third Thursday of each month and the ENSO discussion on
       the second; the Drought Monitor weekly. Past MAX_DAYS the section is
       withheld and the reason printed.

   DATA: data/prf/outlook.json (scripts/fetch_prf_outlook.py, weekly workflow
   prf-outlook.yml). Fetched only when a grid is chosen.

   WIRING: mounts into <section id="prf-outlook">. Listens for a `prf:grid`
   event on document, detail { grid, split }, and reads window.AgPrf.state
   until that event is first seen. The section may carry data-src (the JSON)
   and data-today (YYYY-MM-DD, tests only).

   The pure functions are on window.AgPrfOutlook and tested in
   test/prf-outlook.test.mjs. No em dashes in any copy. */
(function (root) {
  'use strict';

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var IV = ['Jan-Feb', 'Feb-Mar', 'Mar-Apr', 'Apr-May', 'May-Jun', 'Jun-Jul', 'Jul-Aug', 'Aug-Sep', 'Sep-Oct', 'Oct-Nov', 'Nov-Dec'];
  var MAX_DAYS = { seasonal: 38, monthly: 38, enso: 38, drought: 13 };
  var DM = ['D0 Abnormally dry', 'D1 Moderate drought', 'D2 Severe drought', 'D3 Extreme drought', 'D4 Exceptional drought'];

  /* ------------------------------------------------------------ dates */
  function ymd(s) { var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s || ''); return m ? { y: +m[1], m: +m[2], d: m[3] ? +m[3] : 1 } : null; }
  function dayNum(s) { var p = ymd(s); return p ? Date.UTC(p.y, p.m - 1, p.d) / 864e5 : null; }
  function fmtDate(s) { var p = ymd(s); return p ? MON[p.m - 1] + ' ' + p.d + ', ' + p.y : 'an unknown date'; }
  function fmtMonth(s) { var p = ymd(s); return p ? MONTH[p.m - 1] + ' ' + p.y : 'an unknown month'; }
  function ymIndex(s) { var p = ymd(s); return p ? p.y * 12 + p.m - 1 : null; }
  function ymLabel(i) { return MON[i % 12] + ' ' + Math.floor(i / 12); }
  function ageDays(s, today) { var a = dayNum(s), b = dayNum(today); return a == null || b == null ? null : b - a; }

  /* ------------------------------------------------------- the codes */
  /* B4 = below normal favoured, CPC's 40 to 50% band. E = equal chances. "-" = no data. */
  function parseCode(c) {
    if (c === 'E') return { cat: 'E' };
    var m = /^([BAN])([3-9])$/.exec(c || '');
    if (!m) return { cat: null };
    var d = +m[2];
    return { cat: m[1], lo: d === 3 ? 33 : d * 10, hi: d === 9 ? 100 : d === 3 ? 40 : d * 10 + 10 };
  }
  function tilt(c) {
    var p = parseCode(c);
    if (p.cat === 'E') return { key: 'ec', head: 'Equal chances', body: 'no tilt from the usual 1-in-3 odds for below, near or above normal' };
    if (!p.cat) return { key: 'na', head: 'Not available', body: 'CPC’s file has no value at this grid' };
    var lean = p.lo >= 50 ? 'Likely' : 'Leaning';
    var word = { B: ['dry', 'below-normal'], A: ['wet', 'above-normal'], N: ['near normal', 'near-normal'] }[p.cat];
    return { key: { B: 'dry', A: 'wet', N: 'normal' }[p.cat], head: lean + ' ' + word[0], body: p.lo + ' to ' + p.hi + '% chance of ' + word[1] + ' precipitation' };
  }
  function tiltText(c, issued) {
    var t = tilt(c);
    return t.head + ': ' + t.body + ' (CPC, issued ' + fmtDate(issued) + ')';
  }

  /* --------------------------------------------- season -> interval */
  function seasonLabel(lead) {
    var s = ymIndex(lead.start), e = ymIndex(lead.end);
    return MON[s % 12] + (Math.floor(s / 12) !== Math.floor(e / 12) ? ' ' + Math.floor(s / 12) : '') + ' to ' + ymLabel(e);
  }
  /* Interval i (0 = Jan-Feb ... 10 = Nov-Dec) of a crop year: the leads whose
     three months contain both of its months. */
  function seasonsFor(i, cropYear, leads) {
    var a = cropYear * 12 + i, b = a + 1, out = [];
    (leads || []).forEach(function (l, k) {
      var s = ymIndex(l.start), e = ymIndex(l.end);
      if (s != null && e != null && s <= a && b <= e) out.push(k);
    });
    return out;
  }
  /* One interval's row: the seasons, their calls and the sentence. */
  function intervalRow(i, cropYear, seasonal, calls) {
    var leads = seasonal.leads, ks = seasonsFor(i, cropYear, leads), issued = seasonal.issued;
    var row = { i: i, label: IV[i] + ' ' + cropYear, seasons: ks.map(function (k) { return { label: seasonLabel(leads[k]), code: calls[k] }; }) };
    if (!ks.length) {
      var a = cropYear * 12 + i, first = ymIndex(leads[0] && leads[0].start), last = ymIndex(leads[leads.length - 1] && leads[leads.length - 1].end);
      row.kind = 'none';
      row.text = a < first ? 'These months start before the first season in CPC’s current outlook, so it says nothing about them.'
        : a + 1 > last ? 'CPC’s outlooks reach 13 seasons ahead and do not cover these months yet.'
        : 'No CPC season in this outlook contains both of these months.';
      return row;
    }
    var codes = row.seasons.map(function (s) { return s.code; });
    var na = codes.some(function (c) { return !parseCode(c).cat; });
    if (na) { row.kind = 'na'; row.key = 'na'; row.text = 'Not available: CPC’s file has no value at this grid for ' + row.seasons.map(function (s) { return s.label; }).join(' or ') + '.'; return row; }
    if (ks.length === 1) {
      row.kind = 'one'; row.key = tilt(codes[0]).key;
      row.text = tiltText(codes[0], issued) + '. From ' + row.seasons[0].label + ', the only CPC season issued so far that contains these months.';
    } else if (codes[0] === codes[1]) {
      row.kind = 'agree'; row.key = tilt(codes[0]).key;
      row.text = tiltText(codes[0], issued) + '. Both CPC seasons that contain these months, ' + row.seasons[0].label + ' and ' + row.seasons[1].label + ', say the same.';
    } else {
      row.kind = 'differ'; row.key = 'mixed';
      row.text = 'The two CPC seasons that contain these months differ. ' + row.seasons.map(function (s) { var t = tilt(s.code); return s.label + ': ' + t.head.toLowerCase() + (t.key === 'ec' ? '' : ', ' + t.body); }).join('. ')
        + '. CPC gives no figure for these two months alone (CPC, issued ' + fmtDate(issued) + ').';
    }
    return row;
  }

  /* ------------------------------------------------------- lookups */
  var COLS = 300;
  function decode(section, grid) {
    if (!section || !section.rows) return null;
    var row = Math.floor((grid - 1) / COLS), col = (grid - 1) % COLS, r = section.rows[String(row)];
    if (!r) return null;
    var c = r[0];
    for (var k = 1; k < r.length; k += 2) { if (col >= c && col < c + r[k]) return section.calls[r[k + 1]]; c += r[k]; }
    return null;
  }
  /* A section is shown only inside its age limit. Returns null when fine, else the reason. */
  function stale(kind, sec, today) {
    if (!sec) return {
      seasonal: 'CPC’s seasonal outlook has not been fetched yet.',
      monthly: 'CPC’s one-month outlook has not been fetched yet.',
      enso: 'CPC’s ENSO discussion has not been fetched yet.',
      drought: 'The Drought Monitor map has not been fetched yet.' }[kind];
    var when = kind === 'drought' ? sec.map_date : sec.issued, age = ageDays(when, today);
    if (age == null) return 'The file gives no date for this, so it is not shown.';
    if (kind === 'monthly' && ymIndex(sec.month) < ymIndex(today)) return 'The newest one-month outlook here is for ' + fmtMonth(sec.month) + ', which has ended, so it is not shown.';
    if (age > MAX_DAYS[kind]) {
      return kind === 'drought'
        ? 'The newest Drought Monitor map here is for ' + fmtDate(when) + ', ' + age + ' days ago. A new map comes out every Thursday, so this one is not shown.'
        : 'The newest one here was issued ' + fmtDate(when) + ', ' + age + ' days ago. CPC issues a new one every month, so this one is not shown.';
    }
    return null;
  }
  function droughtText(code, sec) {
    var d = code === 'N' ? 'None: not in drought or abnormally dry' : /^[0-4]$/.test(code || '') ? DM[+code] : null;
    if (!d) return null;
    return d + ' at the grid’s center (US Drought Monitor, map for ' + fmtDate(sec.map_date) + ', released ' + fmtDate(sec.released) + ')';
  }
  function ensoText(e) {
    return e.status + (e.synopsis ? '. ' + e.synopsis.replace(/\s*\.$/, '') : '') + ' (CPC, issued ' + fmtDate(e.issued) + ')';
  }

  var API = { MAX_DAYS: MAX_DAYS, IV: IV, parseCode: parseCode, tilt: tilt, tiltText: tiltText, seasonLabel: seasonLabel,
    seasonsFor: seasonsFor, intervalRow: intervalRow, decode: decode, stale: stale, droughtText: droughtText,
    ensoText: ensoText, fmtDate: fmtDate, ageDays: ageDays };
  root.AgPrfOutlook = API;

  /* ================================================================ DOM */
  if (typeof document === 'undefined') return;

  var CSS = [
    '.prfo{max-width:60em;margin:2rem 0 0;padding-top:1rem;border-top:1px solid var(--border-2,rgba(132,160,168,.24));color:var(--text,#e9edeb)}',
    '.prfo h2{font-size:var(--fs-xl,1.3rem);margin:0 0 .5rem;line-height:1.25}',
    '.prfo p{line-height:1.6;margin:0 0 .75rem;color:var(--text-dim,inherit)}',
    '.prfo-lede{max-width:46em}',
    '.prfo-facts{list-style:none;margin:0 0 1rem;padding:0}',
    '.prfo-facts li{padding:.6rem 0;border-top:1px solid var(--border,rgba(132,160,168,.13));line-height:1.55}',
    '.prfo-facts b{color:var(--text,inherit)}',
    '.prfo-wrap{overflow-x:auto;margin:0 0 1rem}',
    '.prfo table{width:100%;border-collapse:collapse;font-size:var(--fs-sm,.88rem)}',
    '.prfo caption{text-align:left;font-weight:700;padding:0 0 .5rem;color:var(--text,inherit);line-height:1.4}',
    '.prfo th,.prfo td{text-align:left;vertical-align:top;padding:.6rem .5rem;border-top:1px solid var(--border,rgba(132,160,168,.13));line-height:1.5}',
    '.prfo thead th{font-size:var(--fs-2xs,.8125rem);color:var(--text-muted,inherit);text-transform:uppercase;letter-spacing:.04em;border-top:0}',
    '.prfo tbody th{white-space:nowrap;font-weight:600;width:7.5em}',
    '.prfo td{border-left:3px solid transparent}',
    '.prfo td.k-dry{border-left-color:var(--orange,#d08a3c)}',
    '.prfo td.k-wet{border-left-color:var(--blue,#6f9fc2)}',
    '.prfo td.k-normal,.prfo td.k-mixed{border-left-color:var(--text-muted,#999)}',
    '.prfo-head{display:block;font-weight:700;color:var(--text,inherit)}',
    '.prfo-mine{display:block;font-size:var(--fs-2xs,.8125rem);font-weight:400;color:var(--text-muted,inherit)}',
    '.prfo-note{border-left:2px solid var(--border-2,rgba(132,160,168,.24));padding:.1rem 0 .1rem .9rem;max-width:46em}',
    '.prfo-withheld{color:var(--text-muted,inherit)}',
    '.prfo-links{list-style:none;margin:.5rem 0 1rem;padding:0;display:flex;flex-wrap:wrap;gap:.25rem 1.25rem}',
    '.prfo-links a,.prfo summary{display:inline-flex;align-items:center;min-height:44px;color:var(--brand,#d4a23f)}',
    '.prfo summary{cursor:pointer}',
    '.prfo details{margin:0 0 1rem;font-size:var(--fs-sm,.88rem)}',
    '.prfo details p,.prfo details li{color:var(--text-muted,inherit)}',
    '.prfo details a{color:var(--brand,#d4a23f)}',
    '.prfo-enso{max-width:30em}',
    '.prfo-enso td,.prfo-enso th{text-align:right;font-family:var(--font-mono,monospace)}',
    '.prfo-enso td:first-child,.prfo-enso th:first-child{text-align:left}',
    '@media (max-width:560px){.prfo tbody th{width:auto;white-space:normal}.prfo th,.prfo td{padding:.55rem .35rem}}'
  ].join('\n');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function mount(el) {
    if (!el || el.getAttribute('data-prfo') === 'on') return;
    el.setAttribute('data-prfo', 'on');
    /* The page ships it hidden; it stays hidden until the outlook file loads, so a missing file shows nothing. */
    el.classList.add('prfo');
    el.setAttribute('aria-labelledby', 'prf-outlook-h');
    if (!document.getElementById('prfo-css')) {
      var st = document.createElement('style'); st.id = 'prfo-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var SRC = el.getAttribute('data-src') || '/data/prf/outlook.json';
    var today = el.getAttribute('data-today') || new Date().toISOString().slice(0, 10);
    el.innerHTML = '<h2 id="prf-outlook-h">Long-range outlook</h2>'
      + '<p class="prfo-lede">What NOAA’s Climate Prediction Center expects for precipitation in the seasons ahead, the ENSO status and today’s drought map, for the grid you are looking at. It is information, not advice: an outlook is not the PRF index and does not predict a payment.</p>'
      + '<div class="prfo-body" aria-live="polite"><p class="prfo-withheld">Find a grid above and its outlook appears here.</p></div>';
    var body = el.querySelector('.prfo-body');
    /* on /prf the panel sits in a folded row of step 4 (details.prf-d, Oct 20): the row shows when the panel does */
    var row = el.closest ? el.closest('details.prf-d') : null;
    var data = null, loading = null, want = null, eventSeen = false;

    function load() {
      if (data || loading) return loading;
      loading = fetch(SRC).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { data = d; return d; })
        .catch(function (e) { loading = null; throw e; });
      return loading;
    }
    function show(g) {
      if (!g || !isFinite(g.grid)) return;
      var key = g.grid + '|' + (g.split || []).join(',');
      if (want === key) return;
      want = key;
      body.innerHTML = '<p class="prfo-withheld">Loading the outlook for grid ' + esc(g.grid) + '…</p>';
      (load() || Promise.resolve(data)).then(function () { if (want === key) { body.innerHTML = render(data, +g.grid, g.split, today); el.hidden = false; if (row) row.hidden = false; } },
        function () { if (want === key) { want = null; el.hidden = true; if (row) row.hidden = true; } });
    }
    document.addEventListener('prf:grid', function (ev) { eventSeen = true; show(ev.detail || {}); });
    /* Until prf.js sends the event: read the state it already exposes. */
    function peek() {
      if (eventSeen) return;
      var s = root.AgPrf && root.AgPrf.state;
      if (s && s.grid) show({ grid: s.grid, split: (s[s.on] || s.A || {}).split });
      setTimeout(peek, 1500);
    }
    peek();
    API._show = show;
  }

  function withheld(why) { return '<span class="prfo-withheld">Withheld. ' + esc(why) + '</span>'; }

  function render(d, grid, split, today) {
    var h = '<ul class="prfo-facts">';
    /* ENSO */
    var why = stale('enso', d.enso, today);
    h += '<li><b>ENSO:</b> ' + (why ? withheld(why) : esc(ensoText(d.enso))) + '</li>';
    /* drought */
    why = stale('drought', d.drought, today);
    var dt = why ? null : droughtText(decode(d.drought, grid), d.drought);
    h += '<li><b>Drought now:</b> ' + (why ? withheld(why) : dt ? esc(dt) : withheld('This grid is not in the Drought Monitor file.')) + '</li>';
    /* next month */
    why = stale('monthly', d.monthly, today);
    var mc = why ? null : decode(d.monthly, grid);
    h += '<li><b>' + (d.monthly && !why ? esc(fmtMonth(d.monthly.month)) + ' alone' : 'Next month') + ':</b> '
      + (why ? withheld(why) : mc ? esc(tiltText(mc, d.monthly.issued)) + '. <span class="prfo-mine">CPC’s one-month outlook. One month is not a PRF interval.</span>' : withheld('This grid is not in CPC’s file.')) + '</li>';
    h += '</ul>';

    /* the intervals */
    why = stale('seasonal', d.seasonal, today);
    var calls = why ? null : decode(d.seasonal, grid);
    if (!why && !calls) why = 'This grid is not in CPC’s file.';
    if (!why && !d.crop_year) why = 'The file does not say which crop year it is for.';
    if (why) {
      h += '<p><b>Seasonal outlook by PRF interval:</b> ' + withheld(why) + '</p>';
    } else {
      calls = calls.split('.');
      h += '<div class="prfo-wrap"><table class="prfo-iv"><caption>CPC precipitation outlook for the ' + d.crop_year + ' PRF intervals, grid ' + grid + '</caption>'
        + '<thead><tr><th scope="col">Interval</th><th scope="col">What CPC’s seasonal outlook says</th></tr></thead><tbody>';
      for (var i = 0; i < 11; i++) {
        var r = intervalRow(i, d.crop_year, d.seasonal, calls);
        /* agree and one-season rows already open with the call; the others get a heading in words */
        var head = r.kind === 'differ' ? 'Seasons differ' : r.kind === 'none' ? 'No outlook yet' : r.kind === 'na' ? 'Not available' : null;
        var mine = split && split[i] > 0 ? '<span class="prfo-mine">in your setup</span>' : '';
        h += '<tr><th scope="row">' + esc(r.label) + mine + '</th><td class="k-' + esc(r.key || 'none') + '">' + (head ? '<span class="prfo-head">' + esc(head) + '</span>' : '') + esc(r.text) + '</td></tr>';
      }
      h += '</tbody></table></div>';
    }

    h += '<p class="prfo-note"><b>How much an outlook says.</b> CPC’s seasonal outlooks shift the odds only a little. Most of the map, most months, is “equal chances”: no tilt from the usual one-in-three. A 40 to 50% lean toward dry still leaves a 50 to 60% chance of near or above normal. Each figure is for a 3-month total over a wide area, not for two months at this grid. The outlook is not the PRF index, and does not predict whether an interval will pay.</p>';

    h += '<ul class="prfo-links">'
      + '<li><a href="' + esc((d.seasonal && d.seasonal.link) || 'https://www.cpc.ncep.noaa.gov/products/predictions/long_range/') + '" rel="noopener" target="_blank">CPC seasonal outlooks</a></li>'
      + '<li><a href="' + esc((d.enso && d.enso.link) || 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml') + '" rel="noopener" target="_blank">CPC ENSO discussion</a></li>'
      + '<li><a href="https://droughtmonitor.unl.edu/" rel="noopener" target="_blank">US Drought Monitor</a></li>'
      + '<li><a href="/drought-monitor">AGSIST drought map</a></li></ul>';

    h += '<details><summary>Where these figures come from</summary>' + sources(d) + '</details>';
    return h;
  }

  function sources(d) {
    var s = '<ul>';
    if (d.seasonal) s += '<li>Seasonal: NOAA Climate Prediction Center, 3-month precipitation outlooks, ' + d.seasonal.leads.length + ' overlapping seasons from ' + esc(seasonLabel(d.seasonal.leads[0])) + ', issued ' + esc(fmtDate(d.seasonal.issued)) + '. Read from ' + esc(d.seasonal.source) + '.</li>';
    if (d.monthly) s += '<li>One month: CPC precipitation outlook for ' + esc(fmtMonth(d.monthly.month)) + ', issued ' + esc(fmtDate(d.monthly.issued)) + '.</li>';
    if (d.enso) s += '<li>ENSO: CPC and IRI ENSO Diagnostic Discussion, issued ' + esc(fmtDate(d.enso.issued)) + '.' + (d.enso.probs ? ' CPC’s official probabilities, same issue:' : '') + '</li>';
    if (d.drought) s += '<li>Drought: US Drought Monitor (National Drought Mitigation Center, USDA, NOAA), map for ' + esc(fmtDate(d.drought.map_date)) + '.</li>';
    s += '</ul>';
    if (d.enso && d.enso.probs) {
      s += '<table class="prfo-enso"><caption>CPC ENSO probabilities by season, %</caption><thead><tr><th scope="col">Season</th><th scope="col">La Niña</th><th scope="col">Neutral</th><th scope="col">El Niño</th></tr></thead><tbody>';
      d.enso.probs.forEach(function (r) { s += '<tr><td>' + esc(r.season) + '</td><td>' + esc(r.la) + '</td><td>' + esc(r.neutral) + '</td><td>' + esc(r.el) + '</td></tr>'; });
      s += '</tbody></table>';
    }
    s += '<p>Each value is read at the grid’s center point. CPC categories are the lower, middle and upper thirds of 1991 to 2020 precipitation for the season. A CPC map shades bands (33 to 40%, 40 to 50%, and so on); the band is all the map gives, so the band is what is printed. Built ' + esc(fmtDate((d.built || '').slice(0, 10))) + ' by scripts/fetch_prf_outlook.py.</p>';
    return s;
  }

  API.render = render;
  function start() { var el = document.getElementById('prf-outlook'); if (el) mount(el); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : this);
