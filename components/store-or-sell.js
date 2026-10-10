/* store-or-sell.js: the /store-or-sell page (2026-10-10).
 *
 * The answer first: "Hold to Jan? +5¢ posted carry, net of storage and
 * interest: −13¢ a bushel." from the nearest elevator to the reader's ZIP that
 * posts a later month for the crop, using the site's one calculation
 * (components/storesell.js holdLine / carryNet). With no ZIP, or no elevator
 * nearby posting a later month, the answer is the futures spread for the
 * storage window with the assumption said out loud: your basis stays where it
 * is today.
 *
 * Everything else is folded under it: the elevator's months, other elevators
 * nearby, the board's carry, and the arithmetic.
 *
 * The reader's storage, interest and shrink are kept in localStorage
 * (agsist_storesell, the same record as the homepage calculator and the cash
 * bids page) as strings: cost in $/bu a month, rate in % a year, shrink in %.
 * Blank boxes take the stated defaults and the page says so.
 */
(function () {
  'use strict';
  var SS = window.AgsistStoreSell, NET = window.AGSIST_BIDS_NET;
  var KEY = 'agsist_storesell', ZKEY = 'agsist_user_zip';
  var CROPS = { corn: 'corn', soybeans: 'soybeans', wheat: 'wheat' };
  var ALIAS = { soybean: 'soybeans', beans: 'soybeans', soy: 'soybeans' };
  var CROP_WORD = { corn: 'corn', soybeans: 'soybeans', wheat: 'wheat' };
  var MAX_TRY = 6;          // elevators read for their later months, nearest first
  var state = { zip: '', crop: 'corn', seq: 0, models: null, futures: null, pick: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  /* ── the reader's costs ─────────────────────────────────────────────── */
  function readSaved() {
    var s = null;
    try { s = JSON.parse(lsGet(KEY) || 'null'); } catch (e) { s = null; }
    return (s && typeof s === 'object') ? s : {};
  }
  function boxes() { return { cost: $('sos-cost'), rate: $('sos-rate'), shrink: $('sos-shrink') }; }
  function restoreCosts() {
    var s = readSaved(), b = boxes();
    if (b.cost && s.cost != null && String(s.cost).trim() !== '' && isFinite(parseFloat(s.cost))) b.cost.value = String(Math.round(parseFloat(s.cost) * 1000) / 10);
    if (b.rate && s.rate != null && String(s.rate).trim() !== '') b.rate.value = s.rate;
    if (b.shrink && s.shrink != null && String(s.shrink).trim() !== '') b.shrink.value = s.shrink;
  }
  function inputs() {
    var b = boxes(), o = {};
    function num(el, max) {
      if (!el) return null;
      var v = String(el.value).trim(), n = v === '' ? null : parseFloat(v);
      var ok = n != null && isFinite(n) && n >= 0 && n <= max;
      el.setAttribute('aria-invalid', v !== '' && !ok ? 'true' : 'false');
      return ok ? n : null;
    }
    var c = num(b.cost, 50);
    o.cost = c == null ? null : c / 100;
    o.rate = num(b.rate, 30);
    o.shrink = num(b.shrink, 20);
    return SS.withDefaults(o);
  }
  function saveCosts() {
    var b = boxes(), c = b.cost ? String(b.cost.value).trim() : '';
    var s = readSaved();
    s.cost = c === '' || !isFinite(parseFloat(c)) ? '' : String(parseFloat(c) / 100);
    s.rate = b.rate ? String(b.rate.value).trim() : '';
    s.shrink = b.shrink ? String(b.shrink.value).trim() : '';
    lsSet(KEY, JSON.stringify(s));
  }

  /* ── where and what ─────────────────────────────────────────────────── */
  function readParams() {
    var q = {};
    try { q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) { q = {}; }
    var c = String(q.crop || '').toLowerCase();
    c = ALIAS[c] || c;
    if (CROPS[c]) state.crop = c;
    var z = String(q.zip || '').trim();
    if (!/^\d{5}$/.test(z)) z = String(lsGet(ZKEY) || '').trim();
    state.zip = /^\d{5}$/.test(z) ? z : '';
    if ($('sos-zip')) $('sos-zip').value = state.zip;
    if ($('sos-crop')) $('sos-crop').value = state.crop;
  }
  function pushUrl() {
    try {
      var u = new URL(location.href);
      if (state.zip) u.searchParams.set('zip', state.zip); else u.searchParams.delete('zip');
      u.searchParams.set('crop', state.crop);
      history.replaceState(null, '', u.pathname + u.search);
    } catch (e) {}
  }

  /* ── the elevators ─────────────────────────────────────────────────── */
  function nameOf(r) {
    var n = r.facility || 'Elevator', city = (r.town || r.city || '').replace(/,\s*[A-Z]{2}$/, '');
    if (city && n.toLowerCase().indexOf(city.toLowerCase()) < 0) n += ', ' + city;
    return n;
  }
  /* Nearest first, one row per elevator for this crop. An elevator whose
     best posted bid sits in a later period than its nearest one is read
     first: it is known to post a later month. */
  function candidates(snap, crop) {
    var seen = {}, out = [];
    (snap && snap.bids || []).forEach(function (r) {
      if (r.crop !== crop || !r.place || seen[r.place]) return;
      seen[r.place] = 1;
      out.push(r);
    });
    var later = out.filter(function (r) { return r.bestPeriod && r.period && String(r.bestPeriod).slice(0, 7) > String(r.period).slice(0, 7); });
    var rest = out.filter(function (r) { return later.indexOf(r) < 0; });
    return later.concat(rest).slice(0, MAX_TRY).sort(function (a, b) { return (a.distance || 0) - (b.distance || 0); });
  }
  function loadElevators(seq) {
    if (!state.zip || !NET || !SS.modelFor) return Promise.resolve([]);
    return NET.snapshotForZip(state.zip).then(function (snap) {
      if (seq !== state.seq) return null;
      var cs = candidates(snap, state.crop);
      return Promise.all(cs.map(function (r) {
        return SS.modelFor({ place: r.place, crop: state.crop, commodity: r.commodity, cropName: CROP_WORD[state.crop] })
          .then(function (m) { return { row: r, model: m }; }, function () { return { row: r, model: { failed: true } }; });
      }));
    }).catch(function () { return []; });
  }

  /* ── the board ─────────────────────────────────────────────────────── */
  function loadFutures() {
    if (state.futuresP) return state.futuresP;
    state.futuresP = fetch('/data/prices.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return state.futuresP;
  }
  function futuresModel(prices, crop) {
    var w = SS.FUTURES_CARRY[crop], q = prices && prices.quotes || {};
    if (!w) return null;
    var a = q[w[0]], b = q[w[1]];
    if (!a || !b || a.close == null || b.close == null) return null;
    var fa = SS.futuresMonth(a.ticker), fb = SS.futuresMonth(b.ticker);
    if (!fa || !fb) return null;
    return { from: fa, to: fb, spot: a.close / 100, carry: (b.close - a.close) / 100,
             months: SS.monthsApart(fa.key, fb.key), date: a.close_date || '' };
  }

  /* ── drawing ───────────────────────────────────────────────────────── */
  function lineFor(m, p, inp) {
    return SS.holdLine({ to: SS.longMon(p.key).slice(0, 3), carry: p.carry, months: p.months, spot: m.spot.cash, kind: 'posted', inputs: inp });
  }
  function tone(n) { var c = Math.round(n * 100); return c > 0 ? 'sos-up' : c < 0 ? 'sos-dn' : ''; }

  function render() {
    var inp = inputs(), ans = $('sos-answer'), where = $('sos-where'), note = $('sos-note');
    var list = (state.models || []).filter(function (x) { return x.model && !x.model.failed && x.model.later && x.model.later.length; });
    var fm = state.futures;
    var top = list[0] || null;
    $('sos-costs-note').textContent = 'Using ' + SS.costNote(inp, null, null);
    if (top) {
      var m = top.model, p = null;
      if (state.pick) m.later.forEach(function (q) { if (q.key === state.pick) p = q; });
      if (!p) p = SS.pickPeriod(m, inp, null);
      var n = SS.carryNet(m.spot.cash, p.carry, p.months, inp).net;
      ans.textContent = lineFor(m, p, inp);
      ans.className = 'sos-line ' + tone(n);
      where.innerHTML = 'At <b>' + esc(nameOf(top.row)) + '</b>' + (top.row.distance != null ? (top.row.distance < 1 ? ', under a mile from ' : ', ' + Math.round(top.row.distance) + ' miles from ') + esc(state.zip) : '') +
        ': its ' + esc(SS.shortMon(m.spot.start)) + ' bid is ' + esc(SS.cashQ(m.spot.cash)) + ' and its ' + esc(SS.shortMon(p.key)) + ' bid is ' + esc(SS.cashQ(p.cash)) + '.' +
        (m.posted ? ' Posted ' + esc(ctTime(m.posted)) + '.' : '');
      note.textContent = 'Net = the later posted bid minus the nearest one, less ' + SS.costNote(inp, p.months, m.spot.cash).replace(/\.$/, '') + '. Call the elevator before you count on a bid.';
      drawTable(m, p, inp);
      drawOthers(list.slice(1), inp);
      drawMath(m.spot.cash, p.carry, p.months, inp, SS.shortMon(m.spot.start) + ' bid', SS.shortMon(p.key) + ' bid');
    } else {
      $('sos-table').innerHTML = '';
      drawOthers([], inp);
      if (fm) {
        var nf = SS.carryNet(fm.spot, fm.carry, fm.months, inp).net;
        ans.textContent = SS.holdLine({ to: fm.to.label.slice(0, 3), carry: fm.carry, months: fm.months, spot: fm.spot, kind: 'futures', inputs: inp });
        ans.className = 'sos-line ' + tone(nf);
        where.textContent = (state.zip ? (state.models === null ? 'Reading the elevators near ' + state.zip + '… ' : 'No elevator we read near ' + state.zip + ' posts a later ' + CROP_WORD[state.crop] + ' bid right now, so this is the board. ') : 'Enter your ZIP for your elevator’s own posted bids. Until then, this is the board. ') +
          fm.from.label + ' to ' + fm.to.label + ' ' + CROP_WORD[state.crop] + ' futures, ' + (fm.date ? 'closes of ' + fm.date : 'latest closes') + '.';
        note.textContent = 'This assumes your basis stays where it is today, so the cash carry equals the futures spread. An elevator\u2019s posted carry can be more or less than the board\u2019s. ' +
          'Interest is figured on the ' + fm.from.label + ' futures price, ' + SS.cashQ(fm.spot) + '; on a lower cash price it would be a little less.';
        drawMath(fm.spot, fm.carry, fm.months, inp, fm.from.label + ' futures', fm.to.label + ' futures');
      } else {
        ans.textContent = state.zip && state.models === null ? 'Reading the elevators near ' + state.zip + '…' : 'Prices did not load. Try again in a minute.';
        ans.className = 'sos-line';
        where.textContent = ''; note.textContent = '';
        drawMath(null);
      }
    }
    drawFutures(fm, inp);
  }

  function drawTable(m, p, inp) {
    var h = '<p class="sos-fine" id="sos-tcap">' + esc(nameOf(state.models.filter(function (x) { return x.model === m; })[0].row)) + ': every posted ' + esc(CROP_WORD[state.crop]) + ' month this crop year. Tap a month to make it the answer.</p>' +
      '<table class="sos-t" aria-describedby="sos-tcap"><thead><tr><th scope="col">Deliver</th><th scope="col">Bid</th><th scope="col">Carry</th><th scope="col">Net/bu</th></tr></thead><tbody>' +
      '<tr><th scope="row">' + esc(SS.shortMon(m.spot.start)) + '</th><td>' + esc(SS.cashQ(m.spot.cash)) + '</td><td colspan="2">Sell now</td></tr>';
    m.later.forEach(function (q) {
      var n = SS.carryNet(m.spot.cash, q.carry, q.months, inp).net, on = q.key === p.key;
      h += '<tr' + (on ? ' class="sos-on"' : '') + '><th scope="row"><button type="button" class="sos-pick" data-k="' + esc(q.key) + '" aria-pressed="' + on + '">' + esc(SS.shortMon(q.key)) + ' <span class="sos-mo">' + q.months + ' mo</span></button></th>' +
        '<td>' + esc(SS.cashQ(q.cash)) + '</td><td>' + esc(SS.carryText(q.carry)) + '</td><td class="' + tone(n) + '">' + esc(SS.netText(n)) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (m.newCrop && m.newCrop.length) h += '<p class="sos-fine">' + esc(m.newCrop.map(SS.shortMon).join(', ')) + ' left out: that is next year’s crop, not stored grain.</p>';
    $('sos-table').innerHTML = h;
  }
  function drawOthers(list, inp) {
    var box = $('sos-others'), wrap = $('sos-others-wrap');
    if (!list.length) { wrap.hidden = true; box.innerHTML = ''; return; }
    wrap.hidden = false;
    box.innerHTML = list.map(function (x) {
      var m = x.model, p = SS.pickPeriod(m, inp, null), n = SS.carryNet(m.spot.cash, p.carry, p.months, inp).net;
      return '<li><b>' + esc(nameOf(x.row)) + '</b>' + (x.row.distance != null ? ' <span class="sos-mo">' + Math.round(x.row.distance) + ' mi</span>' : '') +
        '<br><span class="' + tone(n) + '">' + esc(lineFor(m, p, inp)) + '</span> <span class="sos-mo">' + esc(SS.shortMon(m.spot.start)) + ' ' + esc(SS.cashQ(m.spot.cash)) + ' → ' + esc(SS.shortMon(p.key)) + ' ' + esc(SS.cashQ(p.cash)) + '</span></li>';
    }).join('');
  }
  function drawFutures(fm, inp) {
    var el = $('sos-futures');
    if (!fm) { el.textContent = 'Futures prices did not load.'; return; }
    el.innerHTML = '<b>' + esc(SS.holdLine({ to: fm.to.label.slice(0, 3), carry: fm.carry, months: fm.months, spot: fm.spot, kind: 'futures', inputs: inp })) + '</b> ' +
      esc(fm.from.label + ' ' + SS.cashQ(fm.spot) + ' to ' + fm.to.label + ' ' + SS.cashQ(fm.spot + fm.carry) + ', ' + fm.months + ' months. ') +
      'Futures carry assumes your basis does not change; your elevator’s posted later bids are what it actually pays. ' +
      '<a href="/' + (state.crop === 'soybeans' ? 'soybean' : state.crop) + '-futures-prices">' + esc(CROP_WORD[state.crop].replace(/^./, function (c) { return c.toUpperCase(); })) + ' futures →</a>';
  }
  function money(v) { return '$' + Math.abs(v).toFixed(4).replace(/(\.\d\d)00$/, '$1'); }
  function drawMath(spot, carry, months, inp, a, b) {
    var el = $('sos-math');
    if (spot == null) { el.textContent = ''; return; }
    var n = SS.carryNet(spot, carry, months, inp);
    el.textContent = [
      'Carry (' + b + ' minus ' + a + ')        ' + (carry < 0 ? '−' : '+') + money(carry),
      '− storage ' + money(inp.cost) + ' × ' + months + ' mo          −' + money(n.storage),
      '− interest ' + money(spot) + ' × ' + inp.rate + '% × ' + months + '/12   −' + money(n.interest),
      '− shrink ' + inp.shrink + '% × ' + money(spot + carry) + '        −' + money(n.shrink),
      '= ' + (n.net < 0 ? '−' : '+') + money(n.net) + ' a bushel, rounded to ' + SS.netText(n.net)
    ].join('\n');
  }
  function ctTime(iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    try { return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT'; }
    catch (e) { return ''; }
  }

  /* ── wiring ────────────────────────────────────────────────────────── */
  function run() {
    var seq = ++state.seq;
    state.models = state.zip ? null : [];
    state.pick = null;
    pushUrl();
    loadFutures().then(function (p) { if (seq !== state.seq) return; state.futures = futuresModel(p, state.crop); render(); });
    if (!state.zip) return;
    loadElevators(seq).then(function (ms) { if (seq !== state.seq || ms === null) return; state.models = ms || []; render(); });
  }
  function init() {
    if (!SS || !$('sos-answer')) return;
    readParams();
    restoreCosts();
    var f = $('sos-form');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var z = String($('sos-zip').value).trim();
      if (z !== '' && !/^\d{5}$/.test(z)) { $('sos-zip').setAttribute('aria-invalid', 'true'); $('sos-answer').textContent = 'ZIP: five digits.'; return; }
      $('sos-zip').setAttribute('aria-invalid', 'false');
      state.zip = z; state.crop = $('sos-crop').value;
      if (z) lsSet(ZKEY, z);
      run();
    });
    $('sos-crop').addEventListener('change', function () { state.crop = this.value; run(); });
    var t = null;
    ['sos-cost', 'sos-rate', 'sos-shrink'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('input', function () { saveCosts(); clearTimeout(t); t = setTimeout(render, 250); });
    });
    $('sos-table').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.sos-pick');
      if (!b) return;
      state.pick = b.getAttribute('data-k'); render();
    });
    run();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
