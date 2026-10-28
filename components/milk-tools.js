/* components/milk-tools.js: /milk-prices "Your area" and "Read my check" (dairy board, Oct 27-28, 2026).

   Your area: the reader's AMS mailbox area first, even when it is the worst on the list, with its
   month, change from a year earlier, rank of the areas, the state's NASS all-milk price and the
   nearest Class III futures month. The area comes from the picker, else a saved ZIP or place on
   this device (the keys components/price-local.js reads); a state split between areas or not
   reported asks for the picker. Nothing asks for location.

   Read my check: the federal minimum value of the reader's milk at their tests (butterfat, protein,
   other solids lb per cwt times USDA's announced component prices), then the same at the next two
   Class III futures months as a range, against the reader's own deductions and cost. No national
   cost figure. "Market prices plus your inputs, not your check, not a forecast." Inputs stay in
   this device's localStorage.

   The pure functions are exported for test/milk-tools.test.mjs; the DOM part waits for the page
   script's 'agsist-milk' event (window.agsistMilk: dairy-data.json, the settled futures rows the
   table shows, and whether the class month on the page is current). */
(function (root) {
  'use strict';
  var NAMES = {};
  ('AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming')
    .split('|').forEach(function (s) { NAMES[s.slice(0, 2)] = s.slice(3); });
  /* ZIP prefix to state, the same table as components/price-local.js (test/milk-tools.test.mjs checks) */
  var Z3 = '005NY006--010MA028RI030NH039ME050VT055MA056VT060CT070NJ090--100NY150PA197DE200DC201VA202DC206MD220VA247WV270NC290SC300GA320FL340--341FL350AL370TN386MS398GA400KY430OH460IN480MI500IA530WI550MN569DC570SD580ND590MT600IL630MO660KS680NE700LA716AR730OK733TX734OK750TX800CO820WY832ID840UT850AZ870NM885TX889NV900CA962--967HI969--970OR980WA995AK';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MINUS = '−';
  var AREA_KEY = 'agsist-milk-area', CHECK_KEY = 'agsist-milk-check';
  var MB_LINK = '<a href="https://mymarketnews.ams.usda.gov/viewReport/3357" rel="noopener">AMS mailbox report</a>';

  /* AMS mailbox reporting areas (MMPR footnote) by state. A state split between areas, or only part
     covered, is withheld rather than guessed: the reader picks. */
  var BY_STATE = {
    CT: 'New England States', ME: 'New England States', MA: 'New England States', NH: 'New England States',
    RI: 'New England States', VT: 'New England States', NY: 'New York',
    KY: 'Appalachian States', NC: 'Appalachian States', SC: 'Appalachian States', TN: 'Appalachian States', VA: 'Appalachian States',
    AL: 'Southeast States', AR: 'Southeast States', GA: 'Southeast States', LA: 'Southeast States', MS: 'Southeast States',
    FL: 'Florida', OH: 'Ohio', IN: 'Indiana', MI: 'Michigan', WI: 'Wisconsin', MN: 'Minnesota', IA: 'Iowa', IL: 'Illinois',
    KS: 'Corn Belt States', NE: 'Corn Belt States', NM: 'New Mexico', OR: 'Northwest States', WA: 'Northwest States', CA: 'California'
  };
  var SPLIT = { PA: ['Eastern Pennsylvania', 'Western Pennsylvania'], MO: ['Southern Missouri', 'Corn Belt States'], TX: ['Western Texas'] };
  /* the NASS state an area is, when it is one state (or part of one) */
  var AREA_STATE = { 'New York': 'NY', 'Florida': 'FL', 'Ohio': 'OH', 'Indiana': 'IN', 'Michigan': 'MI', 'Wisconsin': 'WI',
    'Minnesota': 'MN', 'Iowa': 'IA', 'Illinois': 'IL', 'New Mexico': 'NM', 'California': 'CA', 'Eastern Pennsylvania': 'PA',
    'Western Pennsylvania': 'PA', 'Southern Missouri': 'MO', 'Western Texas': 'TX' };

  function zipState(zip) {
    if (!/^\d{5}$/.test(zip || '')) return '';
    var p = +zip.slice(0, 3), st = '';
    for (var i = 0; i < Z3.length; i += 5) { if (+Z3.substr(i, 3) > p) break; st = Z3.substr(i + 3, 2); }
    return NAMES[st] ? st : '';
  }
  function readState(ls) {
    var o = null, z = '';
    try { o = JSON.parse(ls.getItem('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (o && typeof o === 'object') {
      if (NAMES[o.state]) return o.state;
      if (/^\d{5}$/.test(o.zip || '')) return zipState(o.zip);
    }
    try { z = String(ls.getItem('agsist_user_zip') || ls.getItem('agsist_zip') || ''); } catch (e) { z = ''; }
    return zipState(z);
  }
  /* {area} for a state, {split: [areas]} or {none: true} */
  function areaForState(st) {
    if (!st) return null;
    if (BY_STATE[st]) return { area: BY_STATE[st] };
    if (SPLIT[st]) return { split: SPLIT[st] };
    return { none: true };
  }

  function pos(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function r2(x) { return Math.round(x * 100) / 100; }
  function cwt(v) { return '$' + v.toFixed(2); }
  function sg(v) { var r = r2(v); return (r > 0 ? '+' : r < 0 ? MINUS : '') + '$' + Math.abs(r).toFixed(2); }
  function arr(v) { var r = r2(v); return r > 0 ? '▲' : r < 0 ? '▼' : '–'; }
  function cls(v) { var r = r2(v); return r > 0 ? 'dp-pos' : r < 0 ? 'dp-neg' : 'dp-flat'; }
  function money(v) { var r = Math.round(Math.abs(v)); return (v < 0 && r ? MINUS : '') + '$' + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function kidx(k) { var m = /^(\d{4})-(\d{2})$/.exec(k || ''); return m ? +m[1] * 12 + (+m[2]) - 1 : NaN; }
  function ilong(i) { return MONL[i % 12] + ' ' + Math.floor(i / 12); }
  function ishort(i) { return MON[i % 12] + ' ' + Math.floor(i / 12); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function nowIdx(now) { return now.getFullYear() * 12 + now.getMonth(); }
  function dayLabel(d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }

  /* ---------- your area ---------- */
  function areaHtml(mb, d, rows, area, st, now) {
    var ar = mb && mb.areas, idx = kidx(mb && mb.month_key);
    if (!ar || ar.month_key !== mb.month_key || !isFinite(idx) || !Array.isArray(ar.rows)) return '';
    var row = null, ranked = ar.rows.filter(function (r) { return pos(r.value); })
      .sort(function (a, b) { return b.value - a.value; });
    ranked.forEach(function (r, i) { if (r.area === area) { row = r; row._rank = i + 1; } });
    if (!row) return '<p class="dp-area-sum">No mailbox price for ' + esc(area) + ' in the ' + ilong(idx) + ' report.</p>';
    var n = nowIdx(now), old = n - idx >= 5, yl = ishort(idx - 12), pl = MON[(idx + 11) % 12];
    var h = '<p class="dp-area-name">' + esc(area) + ' <span>mailbox price, ' + ilong(idx) + (old ? ' (an older month; newer AMS months are not loaded yet)' : '') + '</span></p>' +
      '<p class="dp-area-big">' + cwt(row.value) + '<span>/cwt</span></p>';
    var ch = [];
    if (pos(row.year_ago)) ch.push('<span class="' + cls(row.value - row.year_ago) + '">' + arr(row.value - row.year_ago) + ' ' + sg(row.value - row.year_ago) + ' vs ' + yl + '</span>');
    if (pos(row.prev)) ch.push('<span class="' + cls(row.value - row.prev) + '">' + arr(row.value - row.prev) + ' ' + sg(row.value - row.prev) + ' vs ' + pl + '</span>');
    if (ch.length) h += '<p class="dp-area-chg">' + ch.join(' &middot; ') + '</p>';
    h += '<p class="dp-area-line">' + ord(row._rank) + ' of ' + ranked.length + ' areas (1st is the highest).' +
      (pos(ar.all) ? ' All federal order areas: ' + cwt(ar.all) + (fin(mb.year_ago_change) ? ' (' + sg(mb.year_ago_change) + ' vs ' + yl + ')' : '') + '.' : '') + '</p>';
    /* the state's NASS all-milk, so a one-month mailbox drop is not read as a trend */
    var sc = AREA_STATE[area] || (st && BY_STATE[st] === area ? st : ''), am = d && d.all_milk_states, us = d && d.all_milk;
    var ai = am ? kidx(am.month_key) : NaN;
    if (sc && am && isFinite(ai) && n - 2 <= ai && ai <= n && Array.isArray(am.rows)) {
      var sr = am.rows.filter(function (r) { return r.state === NAMES[sc]; })[0];
      if (sr && pos(sr.value)) {
        var t = NAMES[sc] + ' all-milk price, ' + ilong(ai) + ': ' + cwt(sr.value);
        if (pos(sr.year_ago)) t += ', ' + sg(sr.value - sr.year_ago) + ' vs a year earlier';
        if (us && us.month_key === am.month_key && pos(us.value) && pos(us.year_ago)) t += ' (US ' + cwt(us.value) + ', ' + sg(us.value - us.year_ago) + ')';
        h += '<p class="dp-area-line">' + esc(t) + '. Before hauling, USDA NASS.</p>';
      }
    }
    var f = (rows || [])[0];
    if (f && pos(f.close)) h += '<p class="dp-area-line">Class III futures, ' + esc(f.label) + ': ' + cwt(f.close) +
      (f.date ? ' (' + (f.kind === 'settle' ? 'CME settle ' : 'close ') + dayLabel(f.date) + ')' : '') + '. A market price, not your check.</p>';
    h += '<p class="dp-note-src">Mailbox price is net pay after hauling and co-op deductions, as USDA AMS reports it for the area. Source: ' + MB_LINK + '.</p>';
    return h;
  }
  function askHtml(st, why) {
    if (why && why.split) return '<p class="dp-area-sum">' + esc(NAMES[st]) + ' is split between AMS mailbox areas (' + esc(why.split.join(', ')) + '). Pick yours above.</p>';
    if (why && why.none) return '<p class="dp-area-sum">AMS does not report a mailbox price for ' + esc(NAMES[st]) + '. Pick the nearest area above, or see the state all-milk table below.</p>';
    return '';
  }

  /* ---------- read my check ---------- */
  /* Class III per cwt carries 3.5 lb butterfat and 0.965 cwt of skim at 3.30 lb protein and 6.00 lb
     other solids (7 CFR 1000.50, factors in force since Dec 1, 2025): 3.1845 and 5.79 lb. */
  var STD = { fat: 3.5, pro: 0.965 * 3.30, os: 0.965 * 6.00 };
  function testValue(t, c) {
    var bf = t.fat * c.butterfat, pr = t.pro * c.protein, os = t.os * c.other_solids;
    return { bf: bf, pr: pr, os: os, val: bf + pr + os };
  }
  function adj(t, c) { return (t.fat - STD.fat) * c.butterfat + (t.pro - STD.pro) * c.protein + (t.os - STD.os) * c.other_solids; }
  function okComp(c) { return c && pos(c.butterfat) && fin(c.protein) && pos(c.other_solids); }
  function readInputs(get) {
    var n = function (id) { var v = parseFloat(get(id)); return isFinite(v) ? v : null; };
    return { cwt: n('ck-cwt'), fat: n('ck-fat'), pro: n('ck-pro'), os: n('ck-os'), ded: n('ck-ded'), cost: n('ck-cost') };
  }
  function bad(t) {
    if (t.fat == null || t.pro == null || t.os == null) return 'Type your butterfat, protein and other solids tests to see what your milk is worth at them.';
    if (t.fat < 2 || t.fat > 7) return 'A butterfat test between 2 and 7 percent, please.';
    if (t.pro < 2 || t.pro > 5) return 'A protein test between 2 and 5 percent, please.';
    if (t.os < 4 || t.os > 7) return 'An other solids test between 4 and 7 percent, please.';
    if (t.cwt != null && (t.cwt <= 0 || t.cwt > 1e7)) return 'Milk shipped in hundredweight, more than zero.';
    if (t.ded != null && (t.ded < 0 || t.ded > 15)) return 'Hauling and deductions between $0 and $15 per cwt, please.';
    if (t.cost != null && (t.cost <= 0 || t.cost > 80)) return 'Your cost between $1 and $80 per cwt, please.';
    return '';
  }
  function line(label, v, c) { return '<div class="dp-example-line' + (c ? ' ' + c : '') + '"><span>' + label + '</span><span class="v">' + v + '</span></div>'; }
  function gapLine(net, t) {
    if (t.cost == null) return '';
    var g = net - t.cost, c = g >= 0 ? 'pos' : 'neg';
    return '<div class="dp-example-line tot"><span>Against your cost of ' + cwt(t.cost) + '/cwt</span><span class="v ' + c + '">' + sg(g) + '/cwt' +
      (t.cwt ? ', ' + money(g * t.cwt) + ' on ' + String(Math.round(t.cwt)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' cwt' : '') + '</span></div>';
  }
  /* d: dairy-data.json; hist: dairy-history.json; rows: settled futures rows; ok: the class month on the page is current */
  function checkHtml(t, d, hist, rows, ok) {
    var why = bad(t);
    if (why) return '<p class="dp-note-src">' + why + '</p>';
    var ci = kidx(d && d.class_month_key), c = d && d.components;
    if (!ok || !isFinite(ci) || !okComp(c)) return '<p class="dp-note-src">Not worked out: the component prices held here are not the newest month, and I will not use old ones.</p>';
    var v = testValue(t, c), ded = t.ded || 0, net = v.val - ded, m = ilong(ci);
    var h = '<div class="dp-example"><div class="dp-example-h">Your milk at ' + m + ' component prices</div>' +
      line('Butterfat ' + t.fat.toFixed(2) + ' lb &times; $' + c.butterfat.toFixed(4), cwt(v.bf)) +
      line('Protein ' + t.pro.toFixed(2) + ' lb &times; $' + c.protein.toFixed(4), cwt(v.pr)) +
      line('Other solids ' + t.os.toFixed(2) + ' lb &times; $' + c.other_solids.toFixed(4), cwt(v.os)) +
      line('<strong>Federal minimum value at your tests</strong>', '<strong>' + cwt(v.val) + '/cwt</strong>', 'tot');
    if (t.ded != null) h += line('Minus your hauling and deductions', MINUS + cwt(ded)) + line('Left before PPD and premiums', cwt(net) + '/cwt');
    h += gapLine(net, t);
    h += '<p class="dp-example-note">USDA AMS component prices announced for ' + m + '. Before the producer price differential, quality and volume premiums and co-op payments; orders that pay on components price milk this way. This is the value of your milk at test, not your check.</p></div>';
    /* the next two futures months not yet announced, as a range over the component prices held */
    var ms = [];
    var hm = (hist && hist.months) || {};
    Object.keys(hm).forEach(function (k) { var r = hm[k]; if (okComp(r) && kidx(k) <= ci) ms.push(r); });
    if (!ms.length) ms.push(c);
    var a = ms.map(function (r) { return adj(t, r); }), lo = Math.min.apply(null, a), hi = Math.max.apply(null, a);
    var fr = (rows || []).filter(function (r) { return pos(r.close) && r.idx > ci; }).slice(0, 2);
    if (fr.length) {
      h += '<div class="dp-example"><div class="dp-example-h">The same milk at Class III futures' + (t.ded != null ? ', after your deductions' : '') + '</div>';
      fr.forEach(function (r) {
        var a1 = r2(r.close + lo - ded), a2 = r2(r.close + hi - ded);
        var rng = a1 === a2 ? 'about ' + cwt(a1) : cwt(Math.min(a1, a2)) + ' to ' + cwt(Math.max(a1, a2));
        var g = t.cost != null ? ' <span class="' + (Math.max(a1, a2) - t.cost >= 0 ? 'dp-pos' : 'dp-neg') + '">(' + sg(Math.min(a1, a2) - t.cost) +
          (a1 === a2 ? '' : ' to ' + sg(Math.max(a1, a2) - t.cost)) + ' vs your cost)</span>' : '';
        h += line(esc(r.label) + ' at ' + cwt(r.close) + (r.date ? ' (' + dayLabel(r.date) + ')' : ''), rng + '/cwt' + g);
      });
      h += '<p class="dp-example-note"><strong>Market prices plus your inputs, not your check, not a forecast.</strong> Class III futures as the table above shows them, ' +
        'plus your tests valued at the component prices of ' + (ms.length > 1 ? 'the last ' + ms.length + ' announced months (the range)' : m) +
        (t.ded != null ? ', minus your deductions' : '') + '. The month is announced early the next month and can land well away from the futures.</p></div>';
    } else {
      h += '<p class="dp-note-src">No current Class III futures in the price file, so no futures months are shown.</p>';
    }
    return h;
  }

  var api = { zipState: zipState, readState: readState, areaForState: areaForState, areaHtml: areaHtml, askHtml: askHtml,
    testValue: testValue, adj: adj, checkHtml: checkHtml, readInputs: readInputs, STD: STD, BY_STATE: BY_STATE, SPLIT: SPLIT };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgMilkTools = api;
  var doc = root.document;
  if (!doc) return;

  function ls() { try { return root.localStorage; } catch (e) { return null; } }
  function lget(k) { var s = ls(); try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function lset(k, v) { var s = ls(); try { if (s) { if (v == null) s.removeItem(k); else s.setItem(k, v); } } catch (e) {} }
  var mb = null, hist = null, data = null, baked = null;
  function getJSON(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }

  function renderArea() {
    var out = doc.getElementById('dp-area-out'), sel = doc.getElementById('dp-area-sel');
    if (!out || !sel || !mb || !data) return;
    var st = '', s = ls();
    try { st = s ? readState(s) : ''; } catch (e) { st = ''; }
    var area = sel.value, ask = '';
    if (!area) {
      var a = areaForState(st);
      if (a && a.area) { area = a.area; sel.value = area; }
      else if (a) ask = askHtml(st, a);
    }
    if (baked == null) baked = out.innerHTML;
    if (!area) { out.innerHTML = ask + baked; return; }
    var h = areaHtml(mb, data.d, data.rows, area, st, new Date());
    if (h) out.innerHTML = h;
  }
  function renderCheck() {
    var out = doc.getElementById('dp-check-out');
    if (!out || !data) return;
    var t = readInputs(function (id) { var e = doc.getElementById(id); return e ? e.value : ''; });
    var ci = kidx(data.d && data.d.class_month_key);
    out.innerHTML = checkHtml(t, data.d, hist, data.rows, data.c3 != null && isFinite(data.classIdx) && data.classIdx === ci);
  }
  function restore() {
    var saved = null;
    try { saved = JSON.parse(lget(CHECK_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved === 'object') ['ck-cwt', 'ck-fat', 'ck-pro', 'ck-os', 'ck-ded', 'ck-cost'].forEach(function (id) {
      var e = doc.getElementById(id); if (e && saved[id] != null && saved[id] !== '') e.value = saved[id];
    });
    var a = lget(AREA_KEY), sel = doc.getElementById('dp-area-sel');
    if (a && sel) { for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === a) sel.value = a; }
  }
  function wire() {
    var sel = doc.getElementById('dp-area-sel');
    if (sel) sel.addEventListener('change', function () { lset(AREA_KEY, sel.value || null); renderArea(); });
    var f = doc.getElementById('dp-check');
    if (f) {
      f.addEventListener('submit', function (e) { e.preventDefault(); });
      f.addEventListener('input', function () {
        var o = {};
        ['ck-cwt', 'ck-fat', 'ck-pro', 'ck-os', 'ck-ded', 'ck-cost'].forEach(function (id) { var e = doc.getElementById(id); if (e) o[id] = e.value; });
        lset(CHECK_KEY, JSON.stringify(o));
        renderCheck();
      });
    }
  }
  function start() {
    data = root.agsistMilk || null;
    if (!data) return;
    Promise.all([getJSON('/data/dairy-mailbox.json'), getJSON('/data/dairy-history.json')]).then(function (r) {
      mb = r[0]; hist = r[1];
      renderArea(); renderCheck();
    });
  }
  restore(); wire();
  if (root.agsistMilk) start(); else doc.addEventListener('agsist-milk', start, { once: true });
})(typeof self !== 'undefined' ? self : this);
