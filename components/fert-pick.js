/* components/fert-pick.js: which fertilizer price a reader sees (Sig, Oct 21, 2026).
   AgFertPick.load(st) -> Promise of a price doc shaped like data/fertilizer-prices.json ({updated, prices, per_lb});
   AgFertPick.choose(coopsDoc, st, today) does the picking with no fetching (node and browser).

   One chooser for Fast Facts (the My place row and the reference-table calculators), /manure-value,
   /nutrient-removal and /urea. For each product:
     1. the reader's own state's current co-op sheets when there are any (a Wisconsin ZIP gets the
        Wisconsin sheet);
     2. otherwise the middle of every current sheet in every state, labeled with the states;
     3. only current sheets: a row older than the file's stale_days (counted from today), undated,
        or flagged is never used.
   One price per co-op per product (its first current row), the middle from two co-ops up (two:
   their average), the same rule as the co-op reader. No co-op is ever named: "one Wisconsin
   co-op" or "middle of 5 co-op price sheets (KS, WI)", always with the posting dates.
   The state comes from the place on the page, else the saved ZIP or location (the keys
   components/loader.js reads). test/fert-pick.test.mjs covers WI, KS and IA ZIPs and stale sheets. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgFertPick = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NAMES = {};
  ('AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming')
    .split('|').forEach(function (s) { NAMES[s.slice(0, 2)] = s.slice(3); });
  /* the order pages list products in, and their names (scripts/build_fert_prices.py NAMES) */
  var ORDER = [['urea', 'Urea', '46-0-0'], ['anhydrous', 'Anhydrous ammonia', '82-0-0'], ['uan28', 'UAN 28%', '28-0-0'], ['uan32', 'UAN 32%', '32-0-0'],
    ['dap', 'DAP', '18-46-0'], ['map', 'MAP', '11-52-0'], ['potash', 'Potash', '0-0-60'], ['ams', 'AMS', '21-0-0-24S'], ['10-34-0', '10-34-0', '10-34-0'], ['thiosul', 'Thio-Sul', '12-0-0-26S']];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ZIP prefix to state (the table components/price-local.js and cb-vs-state.js use) */
  var Z3 = '005NY006--010MA028RI030NH039ME050VT055MA056VT060CT070NJ090--100NY150PA197DE200DC201VA202DC206MD220VA247WV270NC290SC300GA320FL340--341FL350AL370TN386MS398GA400KY430OH460IN480MI500IA530WI550MN569DC570SD580ND590MT600IL630MO660KS680NE700LA716AR730OK733TX734OK750TX800CO820WY832ID840UT850AZ870NM885TX889NV900CA962--967HI969--970OR980WA995AK';
  function zipState(zip) {
    if (!/^\d{5}$/.test(String(zip || ''))) return '';
    var p = +String(zip).slice(0, 3), st = '';
    for (var i = 0; i < Z3.length; i += 5) { if (+Z3.substr(i, 3) > p) break; st = Z3.substr(i + 3, 2); }
    return NAMES[st] ? st : '';
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  /* The reader's state from what this device saved: the location box, else a saved ZIP. */
  function visitorState() {
    var o = null;
    try { o = JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (o && NAMES[o.state]) return o.state;
    if (o && o.zip && zipState(o.zip)) return zipState(o.zip);
    return zipState(lsGet('agsist_user_zip') || lsGet('agsist_zip') || '') || null;
  }

  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function isoToday(now) {
    try { return (now || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); } catch (e) { return (now || new Date()).toISOString().slice(0, 10); }
  }
  function short(iso) { var t = day(iso), d = new Date(t); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  /* "Oct 1, 2026", "Sep 24 to Oct 6, 2026"; year false drops the year */
  function span(lo, hi, year) {
    if (!lo || lo > hi) lo = hi;
    var a = short(lo), b = short(hi), out = lo === hi ? b : lo.slice(0, 4) === hi.slice(0, 4) ? a.slice(0, -6) + ' to ' + b : a + ' to ' + b;
    return year === false && lo.slice(0, 4) === hi.slice(0, 4) ? out.slice(0, -6) : out;
  }
  function median(xs) {
    xs = xs.slice().sort(function (a, b) { return a - b; });
    var n = xs.length;
    if (!n) return null;
    return n % 2 ? xs[(n - 1) / 2] : Math.round((xs[n / 2 - 1] + xs[n / 2]) / 2 * 100) / 100;
  }
  function stName(sts) {
    var n = sts.map(function (s) { return NAMES[s] || s; });
    return n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }
  /* Each co-op's first current row per product: {key: [{st, price, date}]}. */
  function sheets(doc, today) {
    var stale = (doc && doc.stale_days) || 60, t0 = day(today), out = {};
    ((doc && doc.coops) || []).forEach(function (c) {
      var seen = {};
      (c.rows || []).forEach(function (r) {
        var k = r && r.product, t = day(r && r.date);
        if (!k || seen[k] || typeof r.cash !== 'number' || !(r.cash > 0) || t == null) return;
        if (r.stale || (r.flags && r.flags.length) || (t0 != null && (t0 - t) / 864e5 > stale)) return;
        seen[k] = 1;
        (out[k] = out[k] || []).push({ st: String(c.state || '').toUpperCase(), price: r.cash, date: r.date });
      });
    });
    return out;
  }
  function row(key, name, symbol, list, scope, st) {
    var n = list.length, prices = list.map(function (x) { return x.price; }), dates = list.map(function (x) { return x.date; }).sort();
    var sts = [];
    list.forEach(function (x) { if (sts.indexOf(x.st) < 0) sts.push(x.st); });
    sts.sort();
    var lo = dates[0], hi = dates[dates.length - 1], when = span(lo, hi), whenS = span(lo, hi, false);
    var region = stName(sts), long, sh;
    if (n === 1) { long = 'one ' + region + ' co-op, posted ' + when; sh = 'one ' + region + ' co-op, ' + whenS; }
    else if (scope === 'state') { long = (n === 2 ? 'average' : 'middle') + ' of ' + n + ' ' + region + ' co-op price sheets, posted ' + when; sh = n + ' ' + region + ' co-op price sheets, ' + whenS; }
    else { long = (n === 2 ? 'average' : 'middle') + ' of ' + n + ' co-op price sheets (' + sts.join(', ') + '), posted ' + when; sh = n + ' co-op price sheets (' + sts.join(', ') + '), ' + whenS; }
    return { key: key, name: name, symbol: symbol, price: n === 1 ? prices[0] : median(prices), unit: '$/ton', as_of: hi, oldest: lo,
      src: 'coop', n: n, low: Math.min.apply(null, prices), high: Math.max.apply(null, prices), region: region, states: sts,
      scope: scope, state: st || null, src_label: long, short_label: sh };
  }
  /* $/lb of N (urea), P2O5 (MAP, else DAP, its N credited at the urea price) and K2O (potash):
     the same pick as scripts/build_fert_prices.py nutrient_prices. */
  function perLb(prices) {
    var by = {}, out = {};
    prices.forEach(function (p) { by[p.key] = p; });
    function g(sym) { var a = String(sym || '').split('-').map(parseFloat); return a.length >= 3 && a.slice(0, 3).every(isFinite) ? a : null; }
    var u = by.urea, gu = u && g(u.symbol);
    if (u && gu && gu[0] > 0) out.n = { usd: Math.round(u.price / (2000 * gu[0] / 100) * 1e4) / 1e4, from: 'urea', as_of: u.as_of };
    var ph = by.map || by.dap, gp = ph && g(ph.symbol);
    if (ph && gp && gp[1] > 0 && out.n) {
      var credit = 2000 * gp[0] / 100 * (u.price / (2000 * gu[0] / 100));
      out.p = { usd: Math.round((ph.price - credit) / (2000 * gp[1] / 100) * 1e4) / 1e4, from: ph.key, as_of: ph.as_of };
    }
    var k = by.potash, gk = k && g(k.symbol);
    if (k && gk && gk[2] > 0) out.k = { usd: Math.round(k.price / (2000 * gk[2] / 100) * 1e4) / 1e4, from: 'potash', as_of: k.as_of };
    return out;
  }
  /* The price doc for a reader in state st (two letters, or null for no state), on today (YYYY-MM-DD). */
  function choose(doc, st, today) {
    today = today || isoToday();
    st = st && NAMES[String(st).toUpperCase()] ? String(st).toUpperCase() : null;
    var sh = sheets(doc, today), prices = [];
    ORDER.forEach(function (o) {
      var all = sh[o[0]] || [];
      if (!all.length) return;
      var mine = st ? all.filter(function (x) { return x.st === st; }) : [];
      prices.push(mine.length ? row(o[0], o[1], o[2], mine, 'state', st) : row(o[0], o[1], o[2], all, 'all', st));
    });
    return { updated: prices.reduce(function (m, p) { return p.as_of > m ? p.as_of : m; }, '') || null, state: st, today: today,
      prices: prices, per_lb: perLb(prices), source: 'co-op posted cash prices' };
  }
  /* The shared file's own rows, with a single co-op's name taken out (the fallback when the
     co-op file does not load). */
  function anon(file, today) {
    var t0 = day(today || isoToday());
    var list = ((file && file.prices) || []).filter(function (p) { var t = day(p.as_of); return t != null && (t0 == null || (t0 - t) / 864e5 <= 60); }).map(function (p) {
      var q = {}; for (var k in p) q[k] = p[k];
      if (p.src === 'coop' && p.n === 1 && p.as_of) {
        q.src_label = 'one ' + (p.region || '') + ' co-op, posted ' + span(p.as_of, p.as_of);
        q.short_label = 'one ' + (p.region || '') + ' co-op, ' + span(p.as_of, p.as_of, false);
      }
      delete q.coops;
      return q;
    });
    return { updated: file && file.updated || null, state: null, prices: list, per_lb: perLb(list), source: 'co-op posted cash prices' };
  }
  var memo = {};
  function getJSON(u) {
    var w = typeof window !== 'undefined' ? window : null;
    if (w && w.AG && w.AG.json) return w.AG.json(u);
    return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  /* The doc for state st (undefined: the reader's saved state). Never rejects: null when no file loads. */
  function load(st) {
    if (st === undefined) st = visitorState();
    var k = String(st || '');
    if (memo[k]) return memo[k];
    memo[k] = getJSON('/data/fertilizer-coops.json').then(function (doc) {
      var c = choose(doc, st);
      if (!c.prices.length) throw new Error('no current sheet');
      return c;
    }).catch(function () {
      return getJSON('/data/fertilizer-prices.json').then(anon).catch(function () { return null; });
    });
    return memo[k];
  }
  return { choose: choose, load: load, anon: anon, perLb: perLb, visitorState: visitorState, zipState: zipState, span: span, median: median, NAMES: NAMES };
});
