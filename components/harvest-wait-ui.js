/* harvest-wait-ui.js: the /harvest-or-wait page (2026-10-16).
 *
 * The math is components/harvest-wait.js (window.AgHarvestWait). The bid
 * helpers are components/grain-shrink.js (window.AgShrink: nearestBid,
 * defaultBid), the same reader /grain-shrink uses, over the elevator network
 * (components/bids-network.js).
 *
 * Moisture ahead: the published monthly drydown rates, or the reader's own
 * rate. The 14-day forecast (Open-Meteo, as on /gdu-calculator and
 * /grain-emc) is shown as heat per day. It only turns into moisture when
 * AgHarvestWait.GDD_RULE.checked is true (see the header there).
 *
 * Field loss is the reader's number. With none, the page gives the
 * break-even loss instead of an answer.
 *
 * Settings live in localStorage (agsist-harvest-wait); the ZIP in
 * agsist_user_zip, shared with the rest of the site.
 */
(function () {
  'use strict';
  var H = window.AgHarvestWait, S = window.AgShrink, NET = window.AGSIST_BIDS_NET;
  if (!H) return;
  var KEY = 'agsist-harvest-wait', ZKEY = 'agsist_user_zip', MAXD = 14;
  var st = { days: 10, bidFrom: '', zip: '', snap: null, prices: null, basis: null, seq: 0, wseq: 0, wx: null };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function val(id, lo, hi) {
    var el = $(id); if (!el) return null;
    var t = String(el.value).trim(), n = t === '' ? null : parseFloat(t.replace(',', '.'));
    var ok = n != null && isFinite(n) && n >= lo && n <= hi;
    el.setAttribute('aria-invalid', t !== '' && !ok ? 'true' : 'false');
    return ok ? n : null;
  }
  function money(v) { return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dollars(v) { return (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function n1(v, d) { return v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function pct(v) { return v.toFixed(1) + '%'; }
  function cents(v) { return (Math.round(v * 1000) / 10).toFixed(1) + '¢'; }
  function radio(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
  function day(iso) { var p = String(iso).split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]); }
  function ctTime(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    try { return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT'; } catch (e) { return ''; }
  }
  function mdy(iso) {
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function localToday() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function today() { return st.wx && st.wx.days.length && st.wx.days[0].date === localToday() ? st.wx.days[0].date : localToday(); }

  /* ── saved settings ─────────────────────────────────────────── */
  var FIELDS = ['m', 'y', 'ac', 'to', 'lp', 'gal', 'cpp', 'loss', 'own'];
  function save() {
    var o = { cost: radio('hw-cost'), days: st.days, state: $('hw-state').value };
    FIELDS.forEach(function (k) { o[k] = $('hw-' + k).value; });
    lsSet(KEY, JSON.stringify(o));
  }
  function restore() {
    var s; try { s = JSON.parse(lsGet(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') return;
    FIELDS.forEach(function (k) { if (s[k] != null && s[k] !== '') $('hw-' + k).value = s[k]; });
    if (s.cost) { var r = document.querySelector('input[name="hw-cost"][value="' + s.cost + '"]'); if (r) r.checked = true; }
    if (s.days === 7 || s.days === 10 || s.days === 14) st.days = s.days;
    st.savedState = s.state || '';
  }

  /* ── the bid (same rules as /grain-shrink) ───────────────────── */
  function loadData() {
    var g = function (u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    return Promise.all([g('/data/prices.json'), g('/data/basis-states.json')]).then(function (a) { st.prices = a[0]; st.basis = a[1]; fillStates(); });
  }
  function fillStates() {
    var sel = $('hw-state'), b = st.basis && st.basis.states;
    if (!sel || !b) return;
    var cur = sel.value || st.savedState || '';
    var keys = Object.keys(b).filter(function (k) { var c = (b[k].crops || {}).corn; return c && typeof c.median === 'number'; })
      .sort(function (x, y) { return String(b[x].name).localeCompare(String(b[y].name)); });
    sel.innerHTML = '<option value="">Pick a state</option>' + keys.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(b[k].name || k) + '</option>';
    }).join('');
  }
  function setBid(v, from, line) {
    st.bidFrom = from;
    $('hw-bid').value = v == null ? '' : (Math.round(v * 100) / 100).toFixed(2);
    $('hw-bidsrc').innerHTML = line;
  }
  function pickBid() {
    if (st.bidFrom === 'typed' || !S) { render(); return; }
    var n = st.snap ? S.nearestBid(st.snap, 'corn') : null;
    if (n) {
      var where = esc(n.facility || 'Elevator') + (n.town || n.city ? ', ' + esc(String(n.town || n.city).replace(/,\s*[A-Z]{2}$/, '')) : '') + (n.state ? ' ' + esc(n.state) : '');
      setBid(n.cashPrice, 'zip', 'Nearest posted corn bid: <b>' + where + '</b>' +
        (n.distance != null ? ', ' + (n.distance < 1 ? 'under a mile' : Math.round(n.distance) + ' miles') + ' from ' + esc(st.zip) : '') +
        (n.pricedAt ? '. Posted ' + esc(ctTime(n.pricedAt)) : '') + '. Call before you count on it.');
      render(); return;
    }
    var stc = $('hw-state').value;
    var d = stc ? S.defaultBid(st.prices, st.basis, stc, 'corn') : null;
    if (d) {
      setBid(d.bid, 'state', 'State estimate, not a posted bid: ' + esc(d.label) + ' futures ' + money(d.futures) +
        (d.futuresDate ? ' (settle ' + esc(mdy(d.futuresDate)) + ')' : '') + ' ' + (d.basis < 0 ? 'less' : 'plus') + ' the ' + esc(d.stateName) +
        ' median corn basis of ' + Math.round(Math.abs(d.basis) * 100) + '¢ across ' + d.n + ' elevators' + (d.asOf ? ', ' + esc(mdy(d.asOf)) : '') + '. Your ZIP gets the nearest real bid.');
    } else {
      setBid(null, '', (st.snap ? 'No elevator near ' + esc(st.zip) + ' posts a corn bid right now. ' : '') + 'Type your bid to see the break-even loss.');
    }
    render();
  }

  /* ── forecast ───────────────────────────────────────────────── */
  function getJSON(url, ms) {
    var c = typeof AbortController === 'function' ? new AbortController() : null, to;
    var timer = new Promise(function (_, rej) { to = setTimeout(function () { if (c) c.abort(); rej(new Error('timeout')); }, ms || 9000); });
    var req = fetch(url, c ? { signal: c.signal } : {}).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    return Promise.race([req, timer]).then(function (j) { clearTimeout(to); return j; }, function (e) { clearTimeout(to); throw e; });
  }
  function coordFor(z) {
    var p = NET && NET.zipCoord ? NET.zipCoord(z).catch(function () { return null; }) : Promise.resolve(null);
    return p.then(function (c) {
      if (c && isFinite(+c.lat) && isFinite(+c.lon)) return { lat: +c.lat, lon: +c.lon };
      return getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + z + '&count=1&language=en&format=json&countryCode=US', 6000).then(function (d) {
        var r = d && d.results && d.results[0];
        return r ? { lat: r.latitude, lon: r.longitude } : null;
      });
    });
  }
  function loadForecast(z) {
    var my = ++st.wseq;
    return coordFor(z).then(function (c) {
      if (!c) throw new Error('no place');
      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) + '&longitude=' + c.lon.toFixed(3) +
        '&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=' + (MAXD + 1);
      return getJSON(url, 10000);
    }).then(function (d) {
      if (my !== st.wseq) return;
      var dd = d && d.daily, out = [];
      if (!dd || !dd.time) throw new Error('empty');
      for (var i = 0; i < dd.time.length; i++) {
        var hi = dd.temperature_2m_max[i], lo = dd.temperature_2m_min[i];
        out.push({ date: dd.time[i], hi: hi, lo: lo, gdd: H.gddDay(hi, lo) });
      }
      st.wx = { zip: z, days: out };
      render();
    }).catch(function () {
      if (my !== st.wseq) return;
      st.wx = null;
      $('hw-drysrc').textContent = 'Could not get the forecast for ' + z + ' just now. The moisture estimate does not need it.';
    });
  }
  function gddOn(date) {
    if (!st.wx) return null;
    for (var i = 0; i < st.wx.days.length; i++) if (st.wx.days[i].date === date) return st.wx.days[i].gdd;
    return null;
  }

  function lookupZip() {
    var z = String($('hw-zip').value || '').replace(/\D/g, '').slice(0, 5), stat = $('hw-status');
    if (z.length !== 5) { stat.textContent = 'Enter a 5-digit ZIP.'; stat.className = 'hw-status err'; return; }
    $('hw-zip').value = z; st.zip = z; lsSet(ZKEY, z);
    loadForecast(z);
    if (!NET) { stat.textContent = 'The bid reader did not load. Type your bid.'; stat.className = 'hw-status err'; return; }
    var seq = ++st.seq;
    stat.textContent = 'Reading the elevators near ' + z + '…'; stat.className = 'hw-status';
    if (st.bidFrom === 'typed') st.bidFrom = '';
    NET.snapshotForZip(z).then(function (snap) {
      if (seq !== st.seq) return;
      st.snap = snap;
      if (!snap) {
        var s2 = NET.status(z);
        stat.textContent = s2 === 'failed' ? 'Could not read the elevator bids just now. Try again, or pick a state.' :
          s2 === 'pending' ? 'Still loading the elevator bids. Try again in a moment.' :
          'No elevator we read within 75 miles of ' + z + '. Pick a state or type your bid.';
        stat.className = 'hw-status' + (s2 === 'failed' ? ' err' : '');
      } else {
        stat.textContent = '';
        var first = (snap.bids || [])[0], sel = $('hw-state');
        if (first && first.state && sel && !sel.value && sel.querySelector('option[value="' + first.state + '"]')) sel.value = first.state;
      }
      pickBid(); save();
    });
  }

  /* ── the answer ─────────────────────────────────────────────── */
  function costIn() {
    if (radio('hw-cost') === 'point') { var c = val('hw-cpp', 0, 20); return c == null ? null : { kind: 'point', cents: c }; }
    var p = val('hw-lp', 0, 10), g = val('hw-gal', 0.005, 0.05);
    return p == null || g == null ? null : { kind: 'lp', price: p, gal: g };
  }
  function kv(list) { return list.map(function (x) { return '<div><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join(''); }

  function series(m, own) {
    var t = today(), cal = H.calendarDrydown(m, t, MAXD, own);
    if (!cal) return null;
    var byGdd = null;
    if (own == null && H.GDD_RULE.checked && st.wx) {
      var g = []; for (var i = 1; i <= MAXD; i++) g.push(gddOn(cal[i].date));
      byGdd = H.gddDrydown(m, g);
    }
    return cal.map(function (r, i) {
      var useG = byGdd && byGdd[i] != null;
      return { date: r.date, m: useG ? byGdd[i] : r.m, how: useG ? 'gdd' : (own != null ? 'own' : 'cal'), rate: r.rate, floor: r.floor, gdd: gddOn(r.date) };
    });
  }

  function render() {
    var m = val('hw-m', 15, 40), y = val('hw-y', 20, 400), ac = val('hw-ac', 1, 1e6), to = val('hw-to', 12, 18);
    var bid = val('hw-bid', 0.5, 50), loss = val('hw-loss', 0, 50), own = val('hw-own', 0, 10), cost = costIn();
    var V = $('hw-verdict'), sub = $('hw-sub'), box = $('hw-kv'), fine = $('hw-fine'), ans = $('hw-answer'), rows = $('hw-rows'), math = $('hw-math');
    [].forEach.call(document.querySelectorAll('[data-days]'), function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-days') === st.days)); });
    ans.className = 'hw-answer';
    if (m == null || y == null || to == null) {
      V.textContent = 'Enter your moisture, yield and dry-to moisture.'; sub.textContent = ''; box.innerHTML = ''; fine.textContent = '';
      rows.innerHTML = '<tr><td colspan="6" style="text-align:left;font-family:inherit;color:var(--text-muted)">Fills in from your numbers.</td></tr>';
      math.textContent = 'Enter your numbers.'; return;
    }
    var ser = series(m, own);
    if (!ser) {
      V.textContent = 'The published drydown rates cover September through December.';
      sub.textContent = 'Enter your own drydown rate, points a week, to run the numbers for ' + MON[+today().slice(5, 7) - 1] + '.';
      box.innerHTML = ''; fine.textContent = ''; rows.innerHTML = ''; math.textContent = ''; return;
    }
    var o = { yieldBu: y, to: to, cost: cost, bid: bid, lossPerWeek: loss, acres: ac };
    var D = st.days, pick = ser[D], c = H.compare(m, pick.m, D, o);
    var when = day(pick.date), how = pick.how;

    /* the table */
    rows.innerHTML = ser.map(function (r, i) {
      var k = H.compare(m, r.m, i, o);
      var dry = k && k.then.perAcre != null ? money(k.then.perAcre) : '';
      var sv = k && k.saved != null ? (i ? money(k.saved) : '') : '';
      var be = k && k.breakEvenBu != null && i ? n1(k.breakEvenBu, 1) : '';
      return '<tr' + (i === D ? ' class="pick"' : '') + '><th scope="row">' + (i ? esc(day(r.date)) : 'Today') + '</th><td>' + (r.gdd != null ? n1(r.gdd, 0) : '') +
        '</td><td>' + pct(r.m) + '</td><td>' + dry + '</td><td>' + sv + '</td><td>' + be + '</td></tr>';
    }).join('');
    var gsum = 0, gn = 0; for (var i = 1; i <= D; i++) if (ser[i].gdd != null) { gsum += ser[i].gdd; gn++; }
    $('hw-drysrc').textContent = (how === 'own' ? 'Moisture at your own ' + n1(own, 1) + ' points a week' + (ser[D].floor != null ? ', stopping at the month\'s equilibrium moisture' : '') + '.' :
      how === 'gdd' ? 'Moisture from the forecast heat, by the growing degree day rule.' :
      'Moisture by the NDSU and Iowa State monthly rates (' + MON[ser[1].date.slice(5, 7) - 1] + ': ' + n1(ser[1].rate, 1) + ' points a week), not by your weather.') +
      (st.wx ? ' Forecast heat (86/50 GDD) from Open-Meteo for ZIP ' + st.wx.zip + (how === 'gdd' ? '.' : ', shown for reference.') : ' Enter a ZIP for the forecast heat.');

    var dropTxt = pct(m) + ' today to about ' + pct(pick.m) + ' by ' + when;
    var items = [[pct(m) + ' → ' + pct(pick.m), 'moisture, now → ' + esc(when)]];
    if (gn) items.push([n1(gsum, 0) + ' GDD', 'forecast heat, next ' + D + ' days']);

    if (!cost || !c || c.saved == null) {
      V.textContent = 'Corn at ' + dropTxt + '. Add your drying cost for dollars.';
      sub.textContent = 'LP price, or what a point of drying costs you a bushel.';
      box.innerHTML = kv(items); fine.textContent = fineText(how, pick);
      math.textContent = mathText(m, pick, c, o, D); return;
    }
    items.push([money(c.now.perAcre), 'drying an acre today']);
    items.push([money(c.then.perAcre), 'drying an acre ' + esc(when)]);
    if (c.breakEvenBu != null) items.push([n1(c.breakEvenBu, 1) + ' bu', 'loss an acre that eats the savings']);
    if (c.savedFarm != null) items.push([dollars(c.savedFarm), 'drying saved on ' + n1(ac) + ' acres']);

    var savedTxt = money(c.saved) + ' an acre';
    if (c.saved <= 0.005) {
      ans.className = 'hw-answer v-now';
      V.textContent = 'Waiting ' + D + ' days saves nothing on drying: the corn is not expected to dry any further.';
      sub.textContent = 'Corn at ' + dropTxt + '. Field drying has stopped at this month\'s equilibrium moisture, or the corn is already at ' + pct(to) + '.';
    } else if (c.net != null) {
      ans.className = 'hw-answer ' + (c.net >= 0 ? 'v-wait' : 'v-now');
      V.textContent = c.net >= 0
        ? 'Waiting ' + D + ' days comes out about ' + money(c.net) + ' an acre ahead.'
        : 'Harvest now: waiting ' + D + ' days costs about ' + money(-c.net) + ' an acre.';
      sub.textContent = 'Drying saved: ' + savedTxt + ' (' + dropTxt + '). Your field loss: ' + n1(c.lossBu, 1) + ' bu an acre at ' + money(bid) + ' = ' + money(c.lossDollars) + '.' +
        (c.netFarm != null ? ' On ' + n1(ac) + ' acres: ' + dollars(c.netFarm) + '.' : '');
      items.push([money(c.lossDollars), 'your field loss, ' + n1(c.lossBu, 1) + ' bu/ac']);
    } else if (c.breakEvenBu != null) {
      ans.className = 'hw-answer v-even';
      V.textContent = 'Waiting ' + D + ' days saves about ' + savedTxt + ' in drying. It pays only if the field loses less than ' + n1(c.breakEvenBu, 1) + ' bushels an acre by ' + when + '.';
      sub.textContent = 'Corn at ' + dropTxt + '. ' + n1(c.breakEvenBu, 1) + ' bushels is ' + n1(c.breakEvenPct, 1) + '% of ' + n1(y) + '. Put in your own field loss for a yes or no.';
    } else {
      V.textContent = 'Waiting ' + D + ' days saves about ' + savedTxt + ' in drying.';
      sub.textContent = 'Corn at ' + dropTxt + '. Add a bid to see how much field loss that covers.';
    }
    box.innerHTML = kv(items);
    fine.textContent = fineText(how, pick);
    math.textContent = mathText(m, pick, c, o, D);
  }
  function fineText(how, pick) {
    return 'Estimate. ' + (how === 'own' ? 'Drydown at your rate. ' : how === 'gdd' ? 'Drydown from the forecast heat. ' : 'Drydown at the published monthly rate for an average year; a wet or cold stretch dries less. ') +
      'Fuel at today\'s price both ways; Iowa State says a dryer burns about 14% more for every 20 degrees colder. Handling shrink, hauling, labor and dryer capacity are not counted.';
  }
  function mathText(m, pick, c, o, D) {
    var L = [];
    L.push('Moisture in ' + D + ' days = ' + pct(m) + ' less drydown = ' + pick.m.toFixed(2) + '%' +
      (pick.how === 'cal' ? ' (NDSU/ISU weekly rate / 7 a day, never under the month\'s equilibrium moisture)' : pick.how === 'own' ? ' (your rate / 7 a day)' : ''));
    if (!c) return L.join('\n');
    var to = o.to;
    [['Today', c.now], ['Day ' + D, c.then]].forEach(function (x) {
      var a = x[1];
      L.push(x[0] + ': wet bu an acre = ' + o.yieldBu + ' x (100 - ' + to + ') / (100 - ' + a.m.toFixed(2) + ') = ' + a.wetBu.toFixed(2));
      if (a.perWetBu != null) {
        L.push('  drying a wet bu = ' + (o.cost.kind === 'lp' ? o.cost.gal + ' gal x ' + a.points.toFixed(2) + ' points x ' + money(o.cost.price) : a.points.toFixed(2) + ' points x ' + o.cost.cents + '¢') + ' = ' + cents(a.perWetBu));
        L.push('  drying an acre = ' + a.wetBu.toFixed(2) + ' x ' + cents(a.perWetBu) + ' = ' + money(a.perAcre));
      }
    });
    if (c.saved != null) L.push('Saved by waiting = ' + money(c.now.perAcre) + ' - ' + money(c.then.perAcre) + ' = ' + money(c.saved) + ' an acre');
    if (c.breakEvenBu != null) L.push('Break-even loss = ' + money(c.saved) + ' / ' + money(o.bid) + ' = ' + c.breakEvenBu.toFixed(2) + ' bu an acre');
    if (c.net != null) L.push('Your loss = ' + o.lossPerWeek + ' bu a week x ' + D + ' / 7 = ' + c.lossBu.toFixed(2) + ' bu x ' + money(o.bid) + ' = ' + money(c.lossDollars) + '\nNet = ' + money(c.saved) + ' - ' + money(c.lossDollars) + ' = ' + money(c.net) + ' an acre');
    if (o.cost.kind === 'lp') {
      var g = H.gq3FuelPerBu(m, to, o.cost.price);
      if (g != null) L.push('Cross-check, Purdue GQ-3 column dryer, ' + pct(m) + ' to ' + pct(to) + ': ' + Math.round(H.gq3Btu(m, to)).toLocaleString('en-US') + ' BTU x ' + money(o.cost.price) + ' / 92,000 = ' + cents(g) + ' a bushel (read between the table\'s columns)');
    }
    return L.join('\n');
  }

  /* ── wiring ─────────────────────────────────────────────────── */
  function init() {
    restore();
    var q = {}; try { q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) {}
    if (q.m && isFinite(parseFloat(q.m))) $('hw-m').value = parseFloat(q.m);
    if (q.y && isFinite(parseFloat(q.y))) $('hw-y').value = parseFloat(q.y);
    if (q.days === '7' || q.days === '10' || q.days === '14') st.days = +q.days;
    var z = String(q.zip || lsGet(ZKEY) || '').trim();
    if (/^\d{5}$/.test(z)) $('hw-zip').value = z;
    render();

    [].forEach.call(document.querySelectorAll('[data-days]'), function (b) {
      b.addEventListener('click', function () { st.days = +b.getAttribute('data-days'); render(); save(); });
    });
    $('hw-bid').addEventListener('input', function () {
      st.bidFrom = String(this.value).trim() ? 'typed' : '';
      $('hw-bidsrc').textContent = st.bidFrom ? 'Your bid.' : 'Type your bid, or let the page fill one in.';
      render();
    });
    $('hw-zipgo').addEventListener('click', lookupZip);
    $('hw-zip').addEventListener('keydown', function (e) { if (e.key === 'Enter') lookupZip(); });
    $('hw-state').addEventListener('change', function () { if (st.bidFrom === 'typed') st.bidFrom = ''; if (!st.snap || !S || !S.nearestBid(st.snap, 'corn')) pickBid(); save(); });
    document.querySelector('.hw').addEventListener('input', function (e) {
      if (e.target.id === 'hw-bid' || e.target.id === 'hw-zip') return;
      render(); save();
    });
    document.querySelector('.hw').addEventListener('change', function (e) { if (e.target.name === 'hw-cost') { render(); save(); } });

    loadData().then(function () { if (/^\d{5}$/.test($('hw-zip').value)) lookupZip(); else pickBid(); });
    window.addEventListener('agsist:bids-net-ready', function () { if (st.zip && !st.snap) lookupZip(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
