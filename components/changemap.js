/* What changed here this week (god's-eye panel, build 4; Sig, Oct 27 2026: plain SVG on phones,
   no new list, sender or cron). Fast Facts "My place" loads this file only once a place is open
   (components/here.js changeMap()); nothing of it is inline in the page.

   For the open county: a sticky line (county, crop, date), one plain sentence of what changed,
   then a state map whose one fill is the drought change this week, with the corn buyers within
   50 mi, the 50 mi ring and the place. Every line carries its source and date. A line we cannot
   back with a file is withheld and says why; it is never guessed.

   Files, all already on the site, fetched by state, never with the reader's point in the URL:
     data/drought/county-week.json   this week's and last week's Drought Monitor map
     data/arc-plc/geo/<ST>.json      the state's county outlines (the ARC/PLC page's own file)
     the bids network's live index   via window.AGSIST_BIDS_NET (already loaded for the price card)
     data/bids-prev/<ST>.json        each place's last posted price on recent trading days
     data/basis-states.json          the state's middle basis
     data/prices.json                futures, to check which contract a county bid is posted against
     data/land-sales/<st>.json       recorded farm sales (Illinois, Indiana, Wisconsin)

   Rules: drought category = the worst category covering at least half the county (the panel's
   one definition). The top bid compares one delivery period only, and "same place" means the
   same posted top, never "the elevator held its price" (posted times are batch times). No
   company, buyer or seller name anywhere: the page is indexed.

   Works in node (require, for test/changemap.test.mjs) and in the browser (window.AgChangeMap). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgChangeMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DNAME = ['abnormally dry', 'moderate drought', 'severe drought', 'extreme drought', 'exceptional drought'];
  var RING_MI = 50;
  var MIN_BASIS_N = 3;          // the same floor as a state middle (scripts/basis_method.py MIN_STAT)
  var CONTRACT_TOL = 0.07;      // $/bu: a county bid's implied futures within this of the state's contract
  var FEATURED = 6;             // sales rows per county in data/land-sales/<st>.json (build_land_sales.py FEATURED)
  var SALES_MIN_ACRES = 10;     // a listed sale (build_land_sales.py LIST_MIN_ACRES)
  var SALES_STATES = { IL: 'il', IN: 'in', WI: 'wi' };
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
  function topBid(index, prev, lat, lng, today) {
    if (!index || !index.places) return no('the elevator network did not answer');
    var rows = nearCorn(index, lat, lng, RING_MI);
    if (!rows.length) return no('no posted corn bid within ' + RING_MI + ' mi in our network');
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
    return { status: 'ok', same: same, period: period, n: grp.length, nThen: then.length, day: day, when: index.generated || null,
      now: { cash: best.cash, mi: Math.round(best.mi) }, then: { cash: topThen, mi: Math.round(lead.r.mi) }, rows: rows };
  }
  function bidLine(b) {
    if (b.status !== 'ok') return b;
    var pw = periodWords(b.period), src = 'Posted elevator bids', date = md(b.day) + ' and ' + md(b.when);
    var move = b.now.cash === b.then.cash ? 'the same price' : (b.now.cash > b.then.cash ? 'up ' : 'down ') + centWords(b.now.cash - b.then.cash);
    if (b.same) return { status: 'held', label: 'Top corn bid', short: 'the top posted corn bid within ' + RING_MI + ' mi (' + pw + ') is at the same place as on ' + md(b.day) + ', ' + money(b.now.cash) + ', ' + move,
      date: date, src: src, b: b };
    return { status: 'changed', label: 'Top corn bid', b: b,
      lead: 'top corn bid within ' + RING_MI + ' mi now at a different place than ' + md(b.day),
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
  function newSales(file, fips, st) {
    if (!SALES_STATES[st]) return no('recorded farm sales are on hand for Illinois, Indiana and Wisconsin only');
    if (!file || !file.counties || !file.through) return no('the recorded sales file did not load');
    var c = file.counties[fips];
    if (!c || !Array.isArray(c.s)) return no('no recorded sales list for this county');
    var through = file.through, from = through.slice(0, 7) + '-01';
    var inMonth = c.s.filter(function (r) { return r && r[1] >= from && r[1] <= through; }).length;
    /* the file keeps the newest FEATURED sales: the count is exact only when the list reaches back past the month */
    var exact = c.s.length < FEATURED || c.s.some(function (r) { return r && r[1] < from; });
    return { status: 'ok', n: inMonth, exact: exact, month: MONTHS[+through.slice(5, 7) - 1], through: through, fetched: file.fetched || null, source: file.source || 'State deed records' };
  }
  function salesLine(s, county) {
    if (s.status !== 'ok') return s;
    var what = 'recorded farm sale' + (s.n === 1 && s.exact ? '' : 's') + ' of ' + SALES_MIN_ACRES + ' acres or more';
    var date = 'records through ' + md(s.through) + (s.fetched ? ', read ' + md(s.fetched) : '');
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

  /* ── the map ──────────────────────────────────────────────────────── */
  function projector(geo, st) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    var wrap = st === 'AK' ? function (lon) { return lon > 0 ? lon - 360 : lon; } : function (lon) { return lon; };
    geo.c.forEach(function (c) {
      var b = c[3];
      if (!b) return;
      var a = wrap(b[0]), z = wrap(b[2]);
      x0 = Math.min(x0, a, z); x1 = Math.max(x1, a, z); y0 = Math.min(y0, b[1]); y1 = Math.max(y1, b[3]);
    });
    var k = Math.cos((y0 + y1) / 2 * Math.PI / 180), W = 1000, sx = W / ((x1 - x0) * k), H = Math.round((y1 - y0) * sx);
    return { W: W, H: H, p: function (lon, lat) { return [(wrap(lon) - x0) * k * sx, (y1 - lat) * sx]; } };
  }
  function pathOf(P, coords) {
    var out = '';
    (coords || []).forEach(function (poly) {
      (poly || []).forEach(function (ring) {
        var last = null, s = '';
        ring.forEach(function (pt, i) {
          var q = P.p(pt[0], pt[1]);
          if (last && i < ring.length - 1 && Math.abs(q[0] - last[0]) < 0.8 && Math.abs(q[1] - last[1]) < 0.8) return;
          s += (s ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
          last = q;
        });
        if (s) out += s + 'Z';
      });
    });
    return out;
  }
  function ring(P, lat, lng, mi) {
    var R = 3958.8, d = mi / R, la = lat * Math.PI / 180, lo = lng * Math.PI / 180, s = '';
    for (var i = 0; i <= 48; i++) {
      var t = i / 48 * 2 * Math.PI;
      var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t));
      var lo2 = lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
      var q = P.p(lo2 * 180 / Math.PI, la2 * 180 / Math.PI);
      s += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    }
    return s + 'Z';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* geo: data/arc-plc/geo/<ST>.json; fills: droughtFills().by; pts: [{lat, lon}] */
  function svg(geo, opts) {
    var P = projector(geo, opts.st), fills = opts.fills || {}, h = '';
    geo.c.forEach(function (c) {
      var f = fills[c[0]], k = f ? f.k : 'none';
      h += '<path d="' + pathOf(P, c[4]) + '" class="cm-' + k + (c[0] === opts.fips ? ' cm-me' : '') + '" data-f="' + c[0] + '" data-n="' + esc(c[1]) + '"/>';
    });
    var me = geo.c.filter(function (c) { return c[0] === opts.fips; })[0];
    if (me) h += '<path d="' + pathOf(P, me[4]) + '" class="cm-meo"/>';
    if (opts.lat != null && isFinite(opts.lat)) h += '<path d="' + ring(P, opts.lat, opts.lng, RING_MI) + '" class="cm-ring"/>';
    (opts.pts || []).forEach(function (q) { var x = P.p(q.lon, q.lat); h += '<circle cx="' + x[0].toFixed(1) + '" cy="' + x[1].toFixed(1) + '" r="7" class="cm-pt"/>'; });
    if (opts.lat != null && isFinite(opts.lat)) { var y = P.p(opts.lng, opts.lat); h += '<circle cx="' + y[0].toFixed(1) + '" cy="' + y[1].toFixed(1) + '" r="18" class="cm-you"/>'; }
    return '<svg class="cm-svg" viewBox="0 0 ' + P.W + ' ' + P.H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(opts.label || '') + '">' + h + '</svg>';
  }

  /* ── drawing into the page ───────────────────────────────────────── */
  var CSS = '.cm{margin:0 0 1rem;border:1px solid var(--border);border-top:0;border-radius:0 0 10px 10px;background:var(--surface);overflow:clip}' +
    '.cm-top{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:.4rem 0 0;padding:.45rem .75rem;background:var(--surface2);border:1px solid var(--border);border-radius:10px 10px 0 0;font-weight:700;font-size:.95rem;color:var(--text)}' +
    '.cm-top:empty{display:none}' +
    '.cm-top span+span::before{content:"\\00b7";margin-right:.4rem;color:var(--text-muted)}' +
    '#h-cm .cm-lead{grid-area:lead;margin:0;font-size:.95rem;font-weight:600;line-height:1.4;color:var(--text)}' +
    '.cm-grid{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"lead" "map" "side";gap:.35rem;padding:.45rem .75rem .7rem}' +
    '.cm-map{grid-area:map}.cm-side{grid-area:side}' +
    '.cm-map{margin:0}.cm-svg{display:block;width:100%;height:240px}' +
    '.cm-svg path{stroke:var(--bg);stroke-width:1.2;vector-effect:non-scaling-stroke}' +
    '.cm-held{fill:rgba(132,160,168,.30)}.cm-none{fill:rgba(132,160,168,.10)}' +
    '.cm-worse{fill:var(--red)}.cm-better{fill:var(--blue)}' +
    '.cm-svg path.cm-meo{fill:none;stroke:var(--text);stroke-width:2.4}' +
    '.cm-svg path.cm-ring{fill:none;stroke:var(--gold);stroke-width:1.6;stroke-dasharray:5 4}' +
    '.cm-pt{fill:var(--surface);stroke:var(--text);stroke-width:1;vector-effect:non-scaling-stroke}' +
    '.cm-you{fill:var(--gold);stroke:var(--text);stroke-width:2;vector-effect:non-scaling-stroke}' +
    '.cm-key{display:flex;flex-wrap:wrap;gap:.25rem .8rem;margin:.35rem 0 0;padding:0;list-style:none;font-size:.82rem;color:var(--text-dim)}' +
    '.cm-key i{display:inline-block;width:.8rem;height:.8rem;border-radius:2px;margin-right:.3rem;vertical-align:-.1rem}' +
    '.cm-key .cm-worse{background:var(--red)}.cm-key .cm-better{background:var(--blue)}.cm-key .cm-held{background:rgba(132,160,168,.30)}.cm-key .cm-none{background:rgba(132,160,168,.10);border:1px solid var(--border)}' +
    '.cm-key .k-pt,.cm-key .k-you{border-radius:50%}.cm-key .k-pt{background:var(--surface);border:1px solid var(--text)}.cm-key .k-you{background:var(--gold)}' +
    '.cm-key .k-ring{background:none;border:1.5px dashed var(--gold);border-radius:50%}' +
    '.cm-cap,.cm-tap{margin:.3rem 0 0;font-size:.85rem;color:var(--text-dim)}.cm-tap:empty{display:none}' +
    '.cm-lines{margin:0;padding:0;list-style:none}.cm-lines li{padding:.45rem 0;border-top:1px solid var(--border);font-size:.92rem;line-height:1.45;color:var(--text)}' +
    '.cm-lines li:first-child{border-top:0}.cm-lines b{margin-right:.3rem}' +
    '.cm-d{display:block;font-size:.8rem;color:var(--text-muted)}.cm-off{color:var(--text-dim)}' +
    '@media (min-width:900px){.cm-grid{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);grid-template-areas:"map lead" "map side";grid-template-rows:auto 1fr;gap:.5rem 1.2rem;align-items:start}#h-cm .cm-lead{font-size:1.1rem}.cm-svg{height:420px}}' +
    '@media print{.cm{display:none}}';
  function style() {
    if (typeof document === 'undefined' || document.getElementById('cm-css')) return;
    var s = document.createElement('style'); s.id = 'cm-css'; s.textContent = CSS; document.head.appendChild(s);
  }
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
  function centralDay(now) {
    try { return (now || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); } catch (e) { return (now || new Date()).toISOString().slice(0, 10); }
  }
  /* sticky under the site's own sticky bars (the menu, and the price strip where a page has one) */
  function pinBelowNav(el) {
    function set() {
      var y = 0;
      Array.prototype.forEach.call(document.querySelectorAll('.nav, .prices-strip'), function (n) {
        var cs = getComputedStyle(n);
        if (cs.position === 'sticky' || cs.position === 'fixed') y = Math.max(y, Math.round((parseFloat(cs.top) || 0) + n.getBoundingClientRect().height));
      });
      el.style.top = y + 'px';
    }
    set();
    if (!el.getAttribute('data-pin')) { el.setAttribute('data-pin', '1'); window.addEventListener('resize', set); }
  }
  function shortName(n) { return String(n || '').replace(/ County$/, ' Co.'); }
  function getJSON(u, ms) {
    return new Promise(function (ok) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; ok(null); } }, ms || 12000);
      fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { if (!done) { done = true; clearTimeout(t); ok(j); } });
    });
  }
  function labelled(l, label) { if (l.status === 'withheld') l.label = label; return l; }

  /* ctx: {fips, st, stName, name, lat, lng, net, mine()} */
  function draw(box, ctx) {
    style();
    var today = centralDay();
    /* the one-line header sits beside the box, not in it, so it stays in view down the whole place */
    var top = typeof document !== 'undefined' && document.getElementById('cm-top');
    if (!top && box.parentNode) { top = document.createElement('div'); top.id = 'cm-top'; top.className = 'cm-top'; box.parentNode.insertBefore(top, box); }
    if (top) pinBelowNav(top);
    if (top) top.innerHTML = '<span>' + esc(shortName(ctx.name)) + ', ' + esc(ctx.st) + '</span><span>corn</span><span>' + esc(md(today)) + '</span>';
    box.innerHTML = '<div class="cm-grid"><p class="cm-lead" aria-live="polite">Reading what changed here&hellip;</p><figure class="cm-map"></figure><div class="cm-side"></div></div>';
    box.hidden = false;
    var net = ctx.net, idxP = net && net.index ? net.index() : Promise.resolve(null);
    var geoP = getJSON('/data/arc-plc/geo/' + ctx.st + '.json', 20000), drP = getJSON('/data/drought/county-week.json');
    var salesP = SALES_STATES[ctx.st] ? getJSON('/data/land-sales/' + SALES_STATES[ctx.st] + '.json') : Promise.resolve(null);
    var bidP = idxP.then(function (idx) {
      if (!idx) return [idx, {}];
      var sts = {};
      nearCorn(idx, ctx.lat, ctx.lng, RING_MI).forEach(function (r) { if (/^[A-Z]{2}$/.test(r.st)) sts[r.st] = 1; });
      var ks = Object.keys(sts);
      return Promise.all(ks.map(function (s) { return getJSON('/data/bids-prev/' + s + '.json'); })).then(function (fs) {
        var prev = {}; ks.forEach(function (s, i) { prev[s] = fs[i]; }); return [idx, prev];
      });
    });
    var basisP = Promise.all([idxP, getJSON('/data/basis-states.json'), getJSON('/data/prices.json')]);
    return Promise.all([geoP, drP, bidP, basisP, salesP]).then(function (a) {
      if (ctx.mine && !ctx.mine()) return null;
      var geo = a[0], dr = a[1], idx = a[2][0], prev = a[2][1], bs = a[3], sales = a[4];
      var d = droughtChange(dr, ctx.fips), tb = topBid(idx, prev, ctx.lat, ctx.lng, today);
      var lines = [labelled(droughtLine(d), 'Drought'), labelled(bidLine(tb), 'Top corn bid'),
        labelled(basisLine(countyBasis(bs[0], ctx.fips, bs[1], bs[2], ctx.st, ctx.stName, ctx.name), ctx.stName, ctx.name), 'Corn basis'),
        labelled(salesLine(newSales(sales, ctx.fips, ctx.st), ctx.name), 'Land sales')];
      box.querySelector('.cm-lead').textContent = summary(lines);
      box.querySelector('.cm-side').innerHTML = linesHtml(lines);
      var fig = box.querySelector('.cm-map');
      if (!geo || !geo.c || !geo.c.length) { fig.innerHTML = '<p class="cm-cap">The ' + esc(ctx.stName) + ' county outlines did not load. Refresh in a minute.</p>'; return lines; }
      var fl = droughtFills(dr, geo.c.map(function (c) { return c[0]; }));
      var pts = [], seen = {};
      (tb.rows || (idx ? nearCorn(idx, ctx.lat, ctx.lng, RING_MI) : [])).forEach(function (r) { var k = r.lat + ',' + r.lon; if (!seen[k]) { seen[k] = 1; pts.push(r); } });
      var n = fl.n, cap1 = dr ? ctx.stName + ' counties, drought category ' + md(dr.prev) + ' to ' + md(dr.valid) + ': ' + n.worse + ' worse, ' + n.better + ' eased, ' + n.held + ' held' + (n.none ? ', ' + n.none + ' with no map' : '') + '.' : 'The drought map did not load; counties are gray.';
      fig.innerHTML = svg(geo, { st: ctx.st, fips: ctx.fips, fills: fl.by, pts: pts, lat: ctx.lat, lng: ctx.lng, label: cap1 + ' ' + pts.length + ' corn buyers posting within ' + RING_MI + ' mi.' }) +
        '<ul class="cm-key"><li><i class="cm-worse"></i>Worse</li><li><i class="cm-better"></i>Eased</li><li><i class="cm-held"></i>Held</li><li><i class="cm-none"></i>No map</li>' +
        '<li><i class="k-pt"></i>Corn buyer posting (' + pts.length + ')</li><li><i class="k-ring"></i>' + RING_MI + ' mi</li><li><i class="k-you"></i>Your place</li></ul>' +
        '<figcaption class="cm-cap">' + esc(cap1) + ' U.S. Drought Monitor; buyers from posted elevator bids.</figcaption><p class="cm-tap" aria-live="polite"></p>';
      var tap = fig.querySelector('.cm-tap');
      fig.querySelector('svg').addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('path[data-f]') : null;
        if (!t) return;
        var f = fl.by[t.getAttribute('data-f')], dd = f && f.d, nm = t.getAttribute('data-n');
        tap.textContent = !dd || dd.status !== 'ok' ? nm + ': ' + (dd ? dd.why : 'no drought map') + '.' :
          nm + ': ' + (dd.dir === 'held' ? 'held at ' + catWords(dd.now) : (dd.dir === 'worse' ? 'worse, ' : 'eased, ') + catWords(dd.now) + ' from ' + catWords(dd.was)) + ' (' + md(dd.valid) + ' map).';
      });
      return lines;
    });
  }

  return {
    droughtCat: droughtCat, droughtChange: droughtChange, droughtLine: droughtLine, droughtFills: droughtFills,
    nearCorn: nearCorn, topBid: topBid, bidLine: bidLine, periodWords: periodWords, fnv: fnv,
    contractKey: contractKey, countyBasis: countyBasis, basisLine: basisLine,
    newSales: newSales, salesLine: salesLine, summary: summary, linesHtml: linesHtml, svg: svg, draw: draw,
    USDM_SPLIT: USDM_SPLIT, USDM_RESHAPE: USDM_RESHAPE, RING_MI: RING_MI, MIN_BASIS_N: MIN_BASIS_N, FEATURED: FEATURED, SALES_MIN_ACRES: SALES_MIN_ACRES
  };
});
