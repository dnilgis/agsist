/* The line logic behind "what changed here this week" (Sig, Oct 27 2026: god's-eye panel; "Your
   county this week" goes inside the existing Daily slots, no new list, sender or cron).

   One module, three readers, so no two places ever print a different line for one county:
     components/changemap.js   Fast Facts My place: the sentence, the lines and the state map (50 mi)
     components/county-home.js the Farmland Atlas county home: "This week here" (30 mi of the county middle)
     scripts/county_week.mjs   the Thursday Daily, for readers who ticked it and saved a place (30 mi of
                               their ZIP), called by scripts/send_daily.py; nothing of it is logged

   The lines:
     Drought      this week's category against last week's (the worst one covering at least half
                  the county), U.S. Drought Monitor
     Top corn bid the top posted corn bid within the radius on one delivery period, against the
                  oldest earlier trading day in data/bids-prev; "same place" or "different place",
                  never "the elevator held its price" (posted times are batch times)
     Corn basis   the county middle against the state middle, only bids posted against the
                  state's contract, at least MIN_BASIS_N, arithmetic only
     Land sales   recorded farm sales dated in the newest month of the state record, counts only
   Every line carries its date and source. A line no file backs is withheld with its reason; it is
   never guessed. No company, buyer or seller name anywhere.

   Works in node (require) and in the browser (window.AgChangeLines). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgChangeLines = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DNAME = ['abnormally dry', 'moderate drought', 'severe drought', 'extreme drought', 'exceptional drought'];
  var RING_MI = 50;             // the Fast Facts map ring
  var WEEK_MI = 30;             // "Your county this week" in the Daily and on the county home
  var MIN_BASIS_N = 3;          // the same floor as a state middle (scripts/basis_method.py MIN_STAT)
  var CONTRACT_TOL = 0.07;      // $/bu: a county bid's implied futures within this of the state's contract
  var FEATURED = 6;             // sales rows per county in data/land-sales/<st>.json (build_land_sales.py FEATURED)
  var SALES_MIN_ACRES = 10;     // a listed sale (build_land_sales.py LIST_MIN_ACRES)
  var SALES_STATES = { IL: 'il', IN: 'in', WI: 'wi', VT: 'vt' };   // Vermont since Oct 29, 2026
  var FUT_MON = { F: 'jan', H: 'mar', K: 'may', N: 'jul', U: 'sep', Z: 'dec' };

  /* Drought Monitor codes that are not one spine county (data/ids/geo-crosswalk.json, the
     codes whose agencies include usdm). test/changemap.test.mjs rebuilds this from the
     crosswalk and fails the day the two disagree.
       split:   the spine county is mapped as these pieces
       reshape: the state is mapped by areas that do not line up with its spine counties */
  var USDM_SPLIT = { '02261': ['02063', '02066'] };
  var USDM_RESHAPE = { '09': 'Connecticut’s nine planning regions' };

  function stOfFips(fips) { return String(fips || '').slice(0, 2); }
  function md(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function miles(lat1, lon1, lat2, lon2) {
    var R = 3958.8, d = Math.PI / 180, a = Math.sin((lat2 - lat1) * d / 2), b = Math.sin((lon2 - lon1) * d / 2);
    var h = a * a + Math.cos(lat1 * d) * Math.cos(lat2 * d) * b * b;
    return R * 2 * Math.asin(Math.sqrt(h));
  }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
  }
  function cents(x) { return Math.round(Math.abs(x) * 100); }
  function basisWords(b) { var c = cents(b); return c === 0 ? 'even' : c + ' ' + (b < 0 ? 'under' : 'over'); }
  /* boards quote in eighths of a cent: 4.5525 is $4.55\u00bc, never rounded to $4.55 */
  var EIGHTHS = { 0: '', 0.125: '\u215b', 0.25: '\u00bc', 0.375: '\u215c', 0.5: '\u00bd', 0.625: '\u215d', 0.75: '\u00be', 0.875: '\u215e' };
  function split(x) { var c = Math.abs(x) * 100, w = Math.floor(c + 1e-9), f = Math.round((c - w) * 8) / 8; if (f === 1) { w++; f = 0; } return [w, f]; }
  function money(x) { var p = split(x); return '$' + (p[0] / 100).toFixed(2) + EIGHTHS[p[1]]; }
  function centWords(x) { var p = split(x), n = (p[0] || !p[1] ? String(p[0]) : '') + EIGHTHS[p[1]]; return n + (p[0] === 1 && !p[1] ? ' cent' : ' cents'); }
  function no(why) { return { status: 'withheld', why: why }; }
  function bidFilter() {
    try { if (typeof module === 'object' && module.exports) return require('./bid-filter.js'); } catch (e) { /* unfiltered */ }
    return (typeof window !== 'undefined' && window.AG && window.AG.bidFilter) || null;
  }
  /* FNV-1a over UTF-16 code units: the data/bids-prev key (scripts/build_bids_prev.py fnv) */
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /* ── drought ─────────────────────────────────────────────────────── */
  /* The worst category covering at least half the county: -1 none, 0 D0 ... 4 D4; null no map. */
  function droughtCat(row) {
    if (!Array.isArray(row)) return null;
    var c = -1;
    for (var i = 0; i < 5; i++) if (typeof row[i] === 'number' && row[i] >= 50) c = i;
    return c;
  }
  function catWords(c) { return c < 0 ? 'no category over half the county' : 'D' + c + ' ' + DNAME[c]; }
  function rowsFor(file, code) {
    var r = file.c && file.c[code];
    if (!r && file.zero && file.zero.indexOf(code) >= 0) r = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    return r || null;
  }
  /* This week's category against last week's, for one spine county. */
  function droughtChange(file, fips) {
    if (!file || !file.c) return no('the drought map did not load');
    var base = { valid: file.valid, prev: file.prev, source: 'U.S. Drought Monitor' };
    var rows = rowsFor(file, fips), now, was;
    if (rows) {
      now = droughtCat(rows[0]); was = droughtCat(rows[1]);
    } else if (USDM_SPLIT[fips]) {
      /* mapped as pieces: a category holds for the county only when every piece is in it */
      var parts = USDM_SPLIT[fips].map(function (c) { return rowsFor(file, c); });
      if (parts.some(function (r) { return !r; })) return no('the Drought Monitor maps this county in pieces and one piece has no row');
      var a = parts.map(function (r) { return droughtCat(r[0]); }), b = parts.map(function (r) { return droughtCat(r[1]); });
      var same = function (xs) { return xs.every(function (x) { return x === xs[0]; }); };
      if (!same(a) || !same(b)) return no('the Drought Monitor maps this county in pieces that are in different categories');
      now = a[0]; was = b[0];
    } else if (USDM_RESHAPE[stOfFips(fips)]) {
      return no('the Drought Monitor maps ' + USDM_RESHAPE[stOfFips(fips)] + ', which do not line up with this county');
    } else {
      return no('no Drought Monitor row for this county');
    }
    if (now == null || was == null) return no('no Drought Monitor map for ' + (now == null ? 'this week' : 'last week'));
    base.status = 'ok'; base.now = now; base.was = was;
    base.dir = now > was ? 'worse' : now < was ? 'better' : 'held';
    return base;
  }
  function droughtLine(d) {
    if (d.status !== 'ok') return d;
    var span = 'maps of ' + md(d.prev) + ' and ' + md(d.valid);
    if (d.dir === 'held') return { status: 'held', label: 'Drought', short: 'drought at ' + (d.now < 0 ? 'no category over half the county' : 'D' + d.now), date: md(d.valid) + ' map', src: d.source, d: d };
    var up = d.dir === 'worse';
    return { status: 'changed', label: 'Drought', d: d,
      lead: 'drought ' + (up ? 'worse' : 'eased') + ' (' + (d.was < 0 ? 'none' : 'D' + d.was) + ' to ' + (d.now < 0 ? 'none' : 'D' + d.now) + ')',
      text: (up ? 'Worse this week: ' : 'Eased this week: ') + catWords(d.now) + ', from ' + catWords(d.was) + ' a week earlier. Category = the worst one covering at least half the county.',
      date: span, src: d.source };
  }
  function droughtFills(file, list) {
    var out = {}, n = { worse: 0, better: 0, held: 0, none: 0 };
    list.forEach(function (f) {
      var d = droughtChange(file, f), k = d.status === 'ok' ? d.dir : 'none';
      out[f] = { k: k, d: d }; n[k]++;
    });
    return { by: out, n: n };
  }

  /* ── the top posted corn bid within 50 mi, against an earlier trading day ───────── */
  function periodWords(p) {
    var m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?$/.exec(String(p || ''));
    if (m) return m[3] ? MON[+m[2] - 1] + ' to ' + MON[+m[4] - 1] + ' delivery' : MON[+m[2] - 1] + ' delivery';
    if (p === 'spot') return 'spot delivery';
    var n = /^newcrop-(\d{4})$/.exec(String(p || ''));
    return n ? n[1] + ' new crop' : String(p || '');
  }
  /* index: the network's merged index ({generated, places}); prev: {ST: bids-prev file or null};
     today: the Central-time day, YYYY-MM-DD. */
  function nearCorn(index, lat, lng, radius) {
    var BF = bidFilter(), out = [];
    if (!index || !index.places) return out;
    index.places.forEach(function (p) {
      var n = p.now && p.now.corn;
      if (!n || typeof n.cash !== 'number' || !isFinite(n.cash) || !n.period || !p.place) return;
      if ((p.currency || 'USD') !== 'USD' || typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
      if (BF && !BF.canSetBest({ commodity: n.commodity || 'Corn', crop: 'corn', cashPrice: n.cash })) return;
      var d = miles(lat, lng, p.lat, p.lon);
      if (d > radius) return;
      out.push({ key: fnv(p.place + '|corn|' + n.period), site: String(p.operator || '').trim().toLowerCase() + '|' + p.lat.toFixed(3) + '|' + p.lon.toFixed(3), st: String(p.state || '').toUpperCase(), period: n.period, cash: n.cash,
        basis: typeof n.basis === 'number' ? n.basis : null, mi: d, lat: p.lat, lon: p.lon, fips: p.fips || null, co: String(p.operator || '').trim().toLowerCase() });
    });
    return out;
  }
  function topBid(index, prev, lat, lng, today, radius) {
    var R = radius || RING_MI;
    if (!index || !index.places) return no('the elevator network did not answer');
    var rows = nearCorn(index, lat, lng, R);
    if (!rows.length) return no('no posted corn bid within ' + R + ' mi in our network');
    var by = {};
    rows.forEach(function (r) { (by[r.period] = by[r.period] || []).push(r); });
    var period = Object.keys(by).sort(function (a, b) { return by[b].length - by[a].length || (a < b ? -1 : 1); })[0];
    var grp = by[period];
    var best = grp.reduce(function (m, r) { return !m || r.cash > m.cash || (r.cash === m.cash && r.mi < m.mi) ? r : m; }, null);
    /* every place tied for the top now; one board filed under several towns at one pin is one site */
    var nowSites = {};
    grp.forEach(function (r) { if (r.cash === best.cash) nowSites[r.site] = 1; });
    var hist = {}, missing = false;
    grp.forEach(function (r) {
      var f = prev && prev[r.st];
      if (!f || !f.rows) { missing = true; return; }
      var h = f.rows[r.key];
      if (Array.isArray(h)) hist[r.key] = h;
    });
    if (missing) return no('the earlier posted prices did not load');
    var day = null;
    Object.keys(hist).forEach(function (k) { hist[k].forEach(function (e) { if (e && e[0] < today && (!day || e[0] < day)) day = e[0]; }); });
    if (!day) return no('no earlier trading day on record for these bids');
    var then = [];
    grp.forEach(function (r) {
      var e = (hist[r.key] || []).filter(function (x) { return x && x[0] === day && typeof x[1] === 'number'; })[0];
      if (e) then.push({ r: r, cash: e[1] });
    });
    var mine = then.filter(function (t) { return nowSites[t.r.site]; })[0];
    if (!mine) return no('the top place now posted no ' + periodWords(period) + ' corn price on ' + md(day));
    if (then.length < 2) return no('fewer than two places posted ' + periodWords(period) + ' corn on ' + md(day));
    var topThen = then.reduce(function (m, t) { return t.cash > m ? t.cash : m; }, -Infinity);
    var leaders = then.filter(function (t) { return t.cash === topThen; });
    var same = leaders.some(function (t) { return nowSites[t.r.site]; });
    var lead = leaders.reduce(function (m, t) { return !m || t.r.mi < m.r.mi ? t : m; }, null);
    return { status: 'ok', same: same, radius: R, period: period, n: grp.length, nThen: then.length, day: day, when: index.generated || null,
      now: { cash: best.cash, mi: Math.round(best.mi) }, then: { cash: topThen, mi: Math.round(lead.r.mi) }, rows: rows };
  }
  function bidLine(b) {
    if (b.status !== 'ok') return b;
    var pw = periodWords(b.period), src = 'Posted elevator bids', date = md(b.day) + ' and ' + md(b.when), R = b.radius || RING_MI;
    var move = b.now.cash === b.then.cash ? 'the same price' : (b.now.cash > b.then.cash ? 'up ' : 'down ') + centWords(b.now.cash - b.then.cash);
    if (b.same) return { status: 'held', label: 'Top corn bid', short: 'the top posted corn bid within ' + R + ' mi (' + pw + ') is at the same place as on ' + md(b.day) + ', ' + money(b.now.cash) + ', ' + move,
      date: date, src: src, b: b };
    return { status: 'changed', label: 'Top corn bid', b: b,
      lead: 'top corn bid within ' + R + ' mi now at a different place than ' + md(b.day),
      text: 'For ' + pw + ': ' + money(b.now.cash) + ', ' + b.now.mi + ' mi away, now; on ' + md(b.day) + ' the top was ' + money(b.then.cash) + ', ' + b.then.mi + ' mi away. ' + b.nThen + ' of ' + b.n + ' places posted on both days.',
      date: date, src: src };
  }

  /* ── county basis against the state middle, on the state's contract ───────── */
  function contractKey(code) {
    var m = /^ZC([FHKNUZ])(\d{2})$/.exec(String(code || ''));
    return m ? 'corn-' + FUT_MON[m[1]] + m[2] : null;
  }
  function countyBasis(index, fips, states, prices, st, stName, county) {
    var s = states && states.states && states.states[st], c = s && s.crops && s.crops.corn;
    if (!c || typeof c.median !== 'number') return no('no ' + stName + ' corn basis middle this week');
    var key = contractKey(c.contract), q = prices && prices.quotes;
    if (!key || !q || !q[key] || typeof q[key].close !== 'number') return no('the futures price for ' + (c.label || 'the state contract') + ' did not load');
    var keys = Object.keys(q).filter(function (k) { return /^corn-[a-z]{3}\d{2}$/.test(k) && q[k] && typeof q[k].close === 'number'; });
    if (!index || !index.places) return no('the elevator network did not answer');
    var BF = bidFilter(), seen = {}, rows = [];
    index.places.forEach(function (p) {
      var n = p.now && p.now.corn;
      if (p.fips !== fips || !n || typeof n.cash !== 'number' || typeof n.basis !== 'number' || (p.currency || 'USD') !== 'USD') return;
      if (BF && !BF.canSetBest({ commodity: n.commodity || 'Corn', crop: 'corn', cashPrice: n.cash })) return;
      if (seen[p.place]) return;
      var fut = n.cash - n.basis, near = null;
      keys.forEach(function (k) { var dd = Math.abs(fut - q[k].close / 100); if (!near || dd < near.d) near = { k: k, d: dd }; });
      if (!near || near.k !== key || near.d > CONTRACT_TOL) return;   // posted against another month, or a misread board
      seen[p.place] = 1;
      rows.push({ basis: n.basis, co: String(p.operator || '').trim().toLowerCase() });
    });
    var mon = String(c.label || '').split(' ')[0] || 'the state contract';
    if (rows.length < MIN_BASIS_N) return no('fewer than ' + MIN_BASIS_N + ' corn bids in ' + county + ' posted against ' + mon);
    var med = median(rows.map(function (r) { return r.basis; }));
    var cos = {}; rows.forEach(function (r) { if (r.co) cos[r.co] = 1; });
    return { status: 'ok', median: med, n: rows.length, companies: Object.keys(cos).length, state: c.median, stateN: c.n, stateCompanies: typeof c.companies === 'number' ? c.companies : null,
      diff: Math.round((med - c.median) * 100), month: mon, when: index.generated || null, asOf: states.generated || null };
  }
  function basisLine(b, stName, county) {
    if (b.status !== 'ok') return b;
    var d = b.diff, rel = d === 0 ? 'the same as the state middle' : Math.abs(d) + ' cents ' + (d > 0 ? 'stronger' : 'weaker') + ' than the state middle';
    var stCount = b.stateN + ' location' + (b.stateN === 1 ? '' : 's') + (b.stateCompanies != null ? ', ' + b.stateCompanies + ' compan' + (b.stateCompanies === 1 ? 'y' : 'ies') : '');
    return { status: 'level', label: 'Corn basis', b: b,
      text: 'Posted against ' + b.month + ': ' + county + ' middle ' + basisWords(b.median) + ' (' + b.n + ' locations, ' + b.companies + ' compan' + (b.companies === 1 ? 'y' : 'ies') + '), ' + stName + ' middle ' + basisWords(b.state) + ' (' + stCount + '): ' + rel + '.',
      date: md(b.when) + (b.asOf ? ', state ' + md(b.asOf) : ''), src: 'Posted elevator bids' };
  }

  /* ── recorded farm sales in the newest month of the state record ───────── */
  /* since (YYYY-MM-DD, optional): the weekly line counts a month's sales as new only when the
     state file was read on or after that day; read earlier, nothing new came in this week. */
  function newSales(file, fips, st, since) {
    if (!SALES_STATES[st]) return no('recorded farm sales are on hand for Illinois, Indiana, Wisconsin and Vermont only');
    if (!file || !file.counties || !file.through) return no('the recorded sales file did not load');
    var c = file.counties[fips];
    if (!c || !Array.isArray(c.s)) return no('no recorded sales list for this county');
    var through = file.through, from = through.slice(0, 7) + '-01';
    var inMonth = c.s.filter(function (r) { return r && r[1] >= from && r[1] <= through; }).length;
    /* the file keeps the newest FEATURED sales: the count is exact only when the list reaches back past the month */
    var exact = c.s.length < FEATURED || c.s.some(function (r) { return r && r[1] < from; });
    if (since && !file.fetched) return no('the recorded sales file does not say when it was read');
    if (since && String(file.fetched).slice(0, 10) < since)
      return { status: 'ok', n: inMonth, exact: exact, stale: true, month: MONTHS[+through.slice(5, 7) - 1], through: through, fetched: file.fetched || null, source: file.source || 'State deed records' };
    return { status: 'ok', n: inMonth, exact: exact, month: MONTHS[+through.slice(5, 7) - 1], through: through, fetched: file.fetched || null, source: file.source || 'State deed records' };
  }
  function salesLine(s, county) {
    if (s.status !== 'ok') return s;
    var what = 'recorded farm sale' + (s.n === 1 && s.exact ? '' : 's') + ' of ' + SALES_MIN_ACRES + ' acres or more';
    var date = 'records through ' + md(s.through) + (s.fetched ? ', read ' + md(s.fetched) : '');
    if (s.stale) return { status: 'held', label: 'Land sales', short: 'no new recorded farm sales this week (the state record was last read ' + md(s.fetched) + ')', date: date, src: s.source, s: s };
    if (s.n === 0) return { status: 'held', label: 'Land sales', short: 'no new ' + what + ' dated in ' + s.month, date: date, src: s.source, s: s };
    var count = (s.exact ? s.n : 'at least ' + s.n) + ' ' + what;
    return { status: 'changed', label: 'Land sales', s: s, lead: (s.exact ? s.n : 'at least ' + s.n) + ' recorded farm sale' + (s.n === 1 && s.exact ? '' : 's') + ' dated in ' + s.month,
      text: count + ' in ' + county + ' dated in ' + s.month + '. Counts only; the sales list is on the county land page.', date: date, src: s.source };
  }

  /* ── the sentence ─────────────────────────────────────────────────── */
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function summary(lines) {
    var ch = lines.filter(function (l) { return l.status === 'changed'; });
    var known = lines.filter(function (l) { return l.status === 'changed' || l.status === 'held'; });
    if (ch.length) return cap(ch.map(function (l) { return l.lead; }).join('; ')) + '.';
    if (known.length) return 'Nothing changed here this week.';
    return 'Not enough on file here to say what changed this week.';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lineHtml(l) {
    return '<li><b>' + esc(l.label) + '</b>' + esc(l.text) + '<span class="cm-d">' + esc(l.date) + ' &middot; ' + esc(l.src) + '</span></li>';
  }
  function linesHtml(lines) {
    var h = '', held = lines.filter(function (l) { return l.status === 'held'; }), off = lines.filter(function (l) { return l.status === 'withheld'; });
    lines.forEach(function (l) { if (l.status === 'changed' || l.status === 'level') h += lineHtml(l); });
    if (held.length) h += '<li><b>Held</b>' + esc(cap(held.map(function (l) { return l.short; }).join('; '))) + '.<span class="cm-d">' +
      esc(held.map(function (l) { return l.label + ': ' + l.date + ', ' + l.src; }).join(' · ')) + '</span></li>';
    if (off.length) h += '<li class="cm-off"><b>Not shown</b>' + esc(off.map(function (l) { return l.label + ': ' + l.why; }).join('; ')) + '.</li>';
    return '<ul class="cm-lines">' + h + '</ul>';
  }

  /* ── the place: which county a point is in (data/arc-plc/geo/<ST>.json rows: [fips, name, slug, bbox, polygons]) */
  function inRing(ring, x, y) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function countyAt(geo, lat, lng) {
    if (!geo || !Array.isArray(geo.c) || typeof lat !== 'number' || typeof lng !== 'number') return null;
    for (var i = 0; i < geo.c.length; i++) {
      var c = geo.c[i], bb = c[3];
      if (bb && (lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3])) continue;
      var polys = c[4] || [];
      for (var p = 0; p < polys.length; p++) {
        if (!polys[p] || !polys[p][0] || !inRing(polys[p][0], lng, lat)) continue;
        var hole = false;
        for (var h = 1; h < polys[p].length; h++) if (inRing(polys[p][h], lng, lat)) hole = true;
        if (!hole) return c;
      }
    }
    return null;
  }
  function weekAgo(today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 7 * 864e5);
    return d.toISOString().slice(0, 10);
  }

  /* ── one place's week: the four lines, built from files already on the site ───────
     ctx:   {fips, st, stName, name, lat, lng, today (Central day), radius (default WEEK_MI)}
     files: {drought, index, prev: {ST: bids-prev file}, states (basis-states), prices, sales} */
  function weekLines(ctx, files) {
    files = files || {};
    var R = ctx.radius || WEEK_MI, lab = function (l, label) { if (l.status === 'withheld') l.label = label; return l; };
    return [
      lab(droughtLine(droughtChange(files.drought, ctx.fips)), 'Drought'),
      lab(bidLine(topBid(files.index, files.prev, ctx.lat, ctx.lng, ctx.today, R)), 'Top corn bid'),
      lab(basisLine(countyBasis(files.index, ctx.fips, files.states, files.prices, ctx.st, ctx.stName, ctx.name), ctx.stName, ctx.name), 'Corn basis'),
      lab(salesLine(newSales(files.sales, ctx.fips, ctx.st, weekAgo(ctx.today)), ctx.name), 'Land sales')
    ];
  }
  /* The block, or null when nothing changed (no block at all, by rule). Changed lines first, the
     county basis level beside them, every unchanged line in one "Held" row, withheld lines in off. */
  function weekBlock(lines) {
    var ch = (lines || []).filter(function (l) { return l.status === 'changed'; });
    if (!ch.length) return null;
    var rows = ch.map(function (l) { return { kind: 'changed', label: l.label, text: cap(l.text), date: l.date, src: l.src }; });
    lines.forEach(function (l) { if (l.status === 'level') rows.push({ kind: 'level', label: l.label, text: l.text, date: l.date, src: l.src }); });
    var held = lines.filter(function (l) { return l.status === 'held'; });
    if (held.length) rows.push({ kind: 'held', label: 'Held', text: cap(held.map(function (l) { return l.short; }).join('; ')) + '.',
      date: held.map(function (l) { return l.label + ': ' + l.date; }).join('; '), src: held.map(function (l) { return l.src; }).filter(function (s, i, a) { return a.indexOf(s) === i; }).join(', ') });
    var off = lines.filter(function (l) { return l.status === 'withheld'; }).map(function (l) { return { label: l.label, why: l.why }; });
    return { lead: summary(lines), rows: rows, off: off };
  }

  return {
    MON: MON, md: md, miles: miles, money: money, centWords: centWords, esc: esc, cap: cap,
    droughtCat: droughtCat, catWords: catWords, droughtChange: droughtChange, droughtLine: droughtLine, droughtFills: droughtFills,
    nearCorn: nearCorn, topBid: topBid, bidLine: bidLine, periodWords: periodWords, fnv: fnv,
    contractKey: contractKey, countyBasis: countyBasis, basisLine: basisLine,
    newSales: newSales, salesLine: salesLine, summary: summary, linesHtml: linesHtml,
    countyAt: countyAt, weekAgo: weekAgo, weekLines: weekLines, weekBlock: weekBlock,
    USDM_SPLIT: USDM_SPLIT, USDM_RESHAPE: USDM_RESHAPE, RING_MI: RING_MI, WEEK_MI: WEEK_MI, MIN_BASIS_N: MIN_BASIS_N,
    FEATURED: FEATURED, SALES_MIN_ACRES: SALES_MIN_ACRES, SALES_STATES: SALES_STATES
  };
});
