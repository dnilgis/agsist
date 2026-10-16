/* combine-loss-ui.js: the /combine-loss page (2026-10-16).
 *
 * A tap counter for the frame behind the combine. Each saved spot is kept
 * and averaged. The math is components/combine-loss.js (window.AgCombineLoss).
 * The bid comes from the reader, or the nearest posted bid to their ZIP
 * (components/bids-network.js), or the state's futures less median basis,
 * using the same pickers as /grain-shrink (window.AgShrink.nearestBid and
 * defaultBid in components/grain-shrink.js). Each is labeled for what it is.
 *
 * Everything the reader enters stays in this browser (localStorage
 * agsist-combine-loss); the ZIP in agsist_user_zip, shared with the site.
 * Counting needs no network once the page is open.
 */
(function () {
  'use strict';
  var L = window.AgCombineLoss, SH = window.AgShrink, NET = window.AGSIST_BIDS_NET;
  if (!L) return;
  var KEY = 'agsist-combine-loss', ZKEY = 'agsist_user_zip';
  var st = { crop: 'soybeans', area: '10', size: 'medium', earLb: 0.75, spots: { soybeans: [], corn: [] }, bidFrom: '', zip: '', snap: null, prices: null, basis: null, seq: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function val(id, lo, hi) {
    var el = $(id); if (!el) return null;
    var t = String(el.value).trim(), n = t === '' ? null : parseFloat(t);
    var ok = n != null && isFinite(n) && n >= lo && n <= hi;
    el.setAttribute('aria-invalid', t !== '' && !ok ? 'true' : 'false');
    return ok ? n : null;
  }
  function money(v) { return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dollars(v) { return (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function n(v, d) { return v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function cents(v) { return Math.round(v * 100) + '¢'; }
  function press(sel, attr, v) {
    [].forEach.call(document.querySelectorAll(sel), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(v))); });
  }
  function ctTime(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    try { return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT'; } catch (e) { return ''; }
  }
  function mdy(iso) {
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /* ── saved ──────────────────────────────────────────────────── */
  function save() {
    lsSet(KEY, JSON.stringify({
      crop: st.crop, area: st.area, areaOther: $('cl-area').value, size: st.size, earLb: st.earLb, spots: st.spots,
      cur: $('cl-n').value, ears: $('cl-ears').value, rows: $('cl-rows').value, rowin: $('cl-rowin').value,
      yield: $('cl-yield').value, acres: $('cl-acres').value, ahead: $('cl-ahead').value, spl: $('cl-spl').value,
      state: $('cl-state').value
    }));
  }
  function restore() {
    var s = {};
    try { s = JSON.parse(lsGet(KEY) || '{}') || {}; } catch (e) { s = {}; }
    if (s.crop === 'corn' || s.crop === 'soybeans') st.crop = s.crop;
    if (s.area === '10' || s.area === '1' || s.area === 'other') st.area = s.area;
    if (L.BEAN_SIZES[s.size]) st.size = s.size;
    if (s.earLb === 0.5 || s.earLb === 0.75) st.earLb = s.earLb;
    if (s.spots && typeof s.spots === 'object') ['soybeans', 'corn'].forEach(function (c) {
      if (Array.isArray(s.spots[c])) st.spots[c] = s.spots[c].filter(function (x) { return typeof x === 'number' && x >= 0; }).slice(0, 50);
    });
    var map = { areaOther: 'cl-area', cur: 'cl-n', ears: 'cl-ears', rows: 'cl-rows', rowin: 'cl-rowin', yield: 'cl-yield', acres: 'cl-acres', ahead: 'cl-ahead', spl: 'cl-spl' };
    Object.keys(map).forEach(function (k) { if (s[k] != null && s[k] !== '') $(map[k]).value = s[k]; });
    st.savedState = s.state || '';
  }

  /* ── the bid (same pickers as /grain-shrink) ─────────────────── */
  function loadData() {
    function get(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    return Promise.all([get('/data/prices.json'), get('/data/basis-states.json')]).then(function (a) {
      st.prices = a[0]; st.basis = a[1]; fillStates();
    });
  }
  function fillStates() {
    var sel = $('cl-state'), b = st.basis && st.basis.states;
    if (!sel || !b) return;
    var cur = sel.value || st.savedState || '';
    var keys = Object.keys(b).filter(function (k) {
      var c = b[k].crops || {};
      return Object.keys(c).some(function (x) { return c[x] && typeof c[x].median === 'number'; });
    }).sort(function (x, y) { return String(b[x].name).localeCompare(String(b[y].name)); });
    sel.innerHTML = '<option value="">Pick a state</option>' + keys.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(b[k].name || k) + '</option>';
    }).join('');
  }
  function setBid(v, from, line) {
    st.bidFrom = from;
    $('cl-bid').value = v == null ? '' : (Math.round(v * 100) / 100).toFixed(2);
    $('cl-bidsrc').innerHTML = line;
  }
  function pickBid() {
    var c = st.crop, word = c;
    if (st.bidFrom === 'typed') { render(); return; }
    var near = SH && st.snap ? SH.nearestBid(st.snap, c) : null;
    if (near) {
      var where = esc(near.facility || 'Elevator') + (near.town || near.city ? ', ' + esc(String(near.town || near.city).replace(/,\s*[A-Z]{2}$/, '')) : '') + (near.state ? ' ' + esc(near.state) : '');
      setBid(near.cashPrice, 'zip', 'Nearest posted ' + esc(word) + ' bid: <b>' + where + '</b>' +
        (near.distance != null ? ', ' + (near.distance < 1 ? 'under a mile' : Math.round(near.distance) + ' miles') + ' from ' + esc(st.zip) : '') +
        (near.pricedAt ? '. Posted ' + esc(ctTime(near.pricedAt)) : '') + '.');
      render(); return;
    }
    var stc = $('cl-state').value;
    var d = stc && SH ? SH.defaultBid(st.prices, st.basis, stc, c) : null;
    if (d) {
      setBid(d.bid, 'state', 'State estimate, not a posted bid: ' + esc(d.label) + ' futures ' + money(d.futures) +
        (d.futuresDate ? ' (settle ' + esc(mdy(d.futuresDate)) + ')' : '') + ' ' + (d.basis < 0 ? 'less' : 'plus') + ' the ' + esc(d.stateName) +
        ' median basis of ' + cents(Math.abs(d.basis)) + ' across ' + d.n + ' elevators' + (d.asOf ? ', ' + esc(mdy(d.asOf)) : '') + '. Your ZIP gets the nearest real bid.');
    } else {
      var why = st.snap ? 'No elevator near ' + esc(st.zip) + ' posts a ' + esc(word) + ' bid right now. ' : '';
      if (stc && st.basis) why += 'No ' + esc(word) + ' basis median for that state. ';
      setBid(null, '', why + 'Type your bid to see dollars.');
    }
    render();
  }
  function lookupZip() {
    var z = String($('cl-zip').value || '').trim(), stat = $('cl-status');
    if (!/^\d{5}$/.test(z)) { stat.textContent = 'Enter a 5-digit ZIP.'; stat.className = 'cl-status err'; return; }
    st.zip = z; lsSet(ZKEY, z);
    if (!NET || !SH) { stat.textContent = 'The bid reader did not load. Type your bid.'; stat.className = 'cl-status err'; return; }
    var seq = ++st.seq;
    stat.textContent = 'Reading the elevators near ' + z + '…'; stat.className = 'cl-status';
    if (st.bidFrom === 'typed') st.bidFrom = '';
    NET.snapshotForZip(z).then(function (snap) {
      if (seq !== st.seq) return;
      st.snap = snap;
      if (!snap) {
        var s2 = NET.status(z);
        stat.textContent = s2 === 'failed' ? 'Could not read the elevator bids just now. Try again, or pick a state.' :
          s2 === 'pending' ? 'Still loading the elevator bids. Try again in a moment.' :
          'No elevator we read within 75 miles of ' + z + '. Pick a state or type your bid.';
        stat.className = 'cl-status' + (s2 === 'failed' ? ' err' : '');
      } else {
        stat.textContent = '';
        var first = (snap.bids || [])[0], sel = $('cl-state');
        if (first && first.state && sel && !sel.value && sel.querySelector('option[value="' + first.state + '"]')) sel.value = first.state;
      }
      pickBid(); save();
    });
  }

  /* ── counting ───────────────────────────────────────────────── */
  function cur() { var v = parseInt($('cl-n').value, 10); return isFinite(v) && v >= 0 ? v : 0; }
  function bump(id, d, max) {
    var el = $(id), v = parseInt(el.value, 10);
    v = (isFinite(v) ? v : 0) + d;
    el.value = Math.max(0, Math.min(max, v));
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    render(); save();
  }
  function area() {
    if (st.area === 'other') return val('cl-area', 0.1, 1000);
    return parseFloat(st.area);
  }
  /* Saved spots, plus the one on the counter if it is not zero. */
  function counts() {
    var list = st.spots[st.crop].slice(), c = cur();
    if (c > 0 || !list.length) list.push(c);
    return list;
  }
  function spotsLine() {
    var s = st.spots[st.crop];
    $('cl-spots').textContent = s.length ? 'Saved spots: ' + s.join(', ') + (cur() > 0 ? ' (plus ' + cur() + ' on the counter)' : '') : '';
  }

  /* ── the answer ─────────────────────────────────────────────── */
  function kv(list) { return list.map(function (x) { return '<div><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join(''); }
  function render() {
    var c = st.crop, corn = c === 'corn';
    document.documentElement.setAttribute('data-cl', c);
    press('[data-crop]', 'data-crop', c);
    press('[data-area]', 'data-area', st.area);
    press('[data-size]', 'data-size', st.size);
    press('[data-ear]', 'data-ear', st.earLb);
    $('cl-areabox').hidden = st.area !== 'other';
    spotsLine();

    var rows = val('cl-rows', 1, 48), rin = val('cl-rowin', 5, 60);
    var ft = rows != null && rin != null ? L.rowFeet(rows, rin) : null;
    $('cl-walk').textContent = ft != null ? 'Walk ' + n(ft, 1) + ' feet behind the head and pick up every ear across all ' + rows + ' rows. That is 1/100 acre.' : 'Enter the head size to get the distance to walk.';

    var a = area(), bid = val('cl-bid', 0.01, 100), y = val('cl-yield', 1, 400), ac = val('cl-acres', 1, 1000000);
    var ahead = val('cl-ahead', 0, 9999), spl = corn ? null : val('cl-spl', 1000, 6000);
    var ears = corn ? val('cl-ears', 0, 999) : null;
    var V = $('cl-verdict'), sub = $('cl-sub'), box = $('cl-kv'), fine = $('cl-fine'), math = $('cl-math');
    var cnt = counts();
    var o = a == null ? null : L.loss({ crop: c, behind: cnt, ahead: ahead == null ? null : [ahead], area: a, size: st.size, seedsPerLb: spl, ears: ears, earLb: st.earLb, bid: bid, yieldBu: y, acres: ac });
    if (!o) {
      V.textContent = a == null ? 'Enter the frame size.' : 'Count a spot to see the loss.';
      sub.textContent = ''; box.innerHTML = ''; fine.textContent = ''; math.textContent = 'Count a spot first.'; return;
    }
    var lost = o.lostBu, what = o.machineBu != null ? 'lost to the combine' : 'on the ground';
    V.textContent = n(lost, 1) + ' bu/ac ' + what + (o.perAcre != null ? ': ' + money(o.perAcre) + ' an acre at ' + money(bid) + '.' : '.');
    var unit = corn ? 'kernels' : 'beans';
    var sp = cnt.length;
    sub.textContent = (sp > 1 ? 'Average of ' + sp + ' spots: ' + n(o.behindAvg, 1) : n(o.behindAvg, 0)) + ' ' + unit + ' in ' + n(a, a % 1 ? 1 : 0) + ' sq ft, ' +
      n(o.behindAvg / a, 2) + ' a sq ft. ' + n(o.per, o.per % 1 ? 2 : 0) + ' a sq ft is 1 bu/ac' + (corn ? '.' : (spl ? ' at ' + n(spl) + ' seeds a pound.' : ' for ' + st.size + ' beans.')) +
      (corn && o.earBu ? ' Ears add ' + n(o.earBu, 2) + ' bu/ac.' : '') +
      (o.machineBu != null ? ' Ahead of the combine: ' + n(o.aheadBu, 2) + ' bu/ac was already down.' : '');
    var it = [[n(lost, 2) + ' bu/ac', what]];
    if (o.perAcre != null) it.push([money(o.perAcre), 'an acre']);
    if (o.farm != null) it.push([dollars(o.farm), 'on ' + n(ac) + ' acres']);
    if (o.pctYield != null) it.push([n(o.pctYield, 1) + '%', 'of a ' + n(y + lost, 0) + ' bu crop']);
    if (o.machineBu != null) it.push([n(o.totalBu, 2) + ' bu/ac', 'all of it, ahead and behind']);
    box.innerHTML = kv(it);
    fine.textContent = (bid == null ? 'Add a bid for dollars. ' : '') + (sp < 3 ? 'One spot can mislead; count three or more and average. ' : '') +
      (corn ? 'Iowa State: machine loss in standing corn should run about 1 bu/ac or less.' : 'NDSU aims for 1 to 2 bu/ac of total loss.');
    var m = 'Average count = ' + cnt.join(' + ') + (sp > 1 ? ' / ' + sp : '') + ' = ' + n(o.behindAvg, 2) + '\n' +
      'Per sq ft = ' + n(o.behindAvg, 2) + ' / ' + a + ' = ' + n(o.behindAvg / a, 3) + '\n' +
      (!corn && spl ? 'Beans for 1 bu/ac = ' + spl + ' x 60 / 43,560 = ' + n(o.per, 3) + ' a sq ft\n' : '') +
      'Behind the combine = ' + n(o.behindAvg / a, 3) + ' / ' + n(o.per, o.per % 1 ? 3 : 0) + ' = ' + n(o.behindBu, 3) + ' bu/ac\n' +
      (corn && o.earBu ? 'Ears = ' + ears + ' x (' + st.earLb + ' / 0.75) = ' + n(o.earBu, 3) + ' bu/ac\n' : '') +
      (o.machineBu != null ? 'Ahead = ' + ahead + ' / ' + a + ' / ' + n(o.per, o.per % 1 ? 3 : 0) + ' = ' + n(o.aheadBu, 3) + ' bu/ac\nCombine loss = ' + n(o.behindBu, 3) + ' - ' + n(o.aheadBu, 3) + (o.earBu ? ' + ' + n(o.earBu, 3) : '') + ' = ' + n(o.machineBu, 3) + ' bu/ac\n' : '') +
      (o.perAcre != null ? 'Dollars = ' + n(lost, 3) + ' x ' + money(bid) + ' = ' + money(o.perAcre) + ' an acre' + (o.farm != null ? '\nOn ' + n(ac) + ' acres = ' + dollars(o.farm) : '') : 'Add a bid for dollars.');
    math.textContent = m;
  }

  /* ── wiring ─────────────────────────────────────────────────── */
  function setCrop(c) {
    st.crop = c;
    if (st.bidFrom === 'typed') { $('cl-bid').value = ''; st.bidFrom = ''; }
    $('cl-n').value = 0;
    pickBid();
  }
  function init() {
    restore();
    var q = {};
    try { q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) {}
    var qc = String(q.crop || '').toLowerCase();
    if (qc === 'beans' || qc === 'soybean' || qc === 'soybeans') st.crop = 'soybeans';
    if (qc === 'corn') st.crop = 'corn';
    var z = String(q.zip || lsGet(ZKEY) || '').trim();
    if (/^\d{5}$/.test(z)) $('cl-zip').value = z;
    render();

    [].forEach.call(document.querySelectorAll('[data-crop]'), function (b) { b.addEventListener('click', function () { setCrop(b.getAttribute('data-crop')); save(); }); });
    [].forEach.call(document.querySelectorAll('[data-area]'), function (b) { b.addEventListener('click', function () { st.area = b.getAttribute('data-area'); render(); save(); }); });
    [].forEach.call(document.querySelectorAll('[data-size]'), function (b) { b.addEventListener('click', function () { st.size = b.getAttribute('data-size'); $('cl-spl').value = ''; render(); save(); }); });
    [].forEach.call(document.querySelectorAll('[data-ear]'), function (b) { b.addEventListener('click', function () { st.earLb = parseFloat(b.getAttribute('data-ear')); render(); save(); }); });
    $('cl-plus').addEventListener('click', function () { bump('cl-n', 1, 9999); });
    $('cl-minus').addEventListener('click', function () { bump('cl-n', -1, 9999); });
    $('cl-eplus').addEventListener('click', function () { bump('cl-ears', 1, 999); });
    $('cl-eminus').addEventListener('click', function () { bump('cl-ears', -1, 999); });
    $('cl-save').addEventListener('click', function () {
      if (st.spots[st.crop].length >= 50) return;
      st.spots[st.crop].push(cur()); $('cl-n').value = 0; render(); save();
    });
    $('cl-clear').addEventListener('click', function () {
      st.spots[st.crop] = []; $('cl-n').value = 0; if (st.crop === 'corn') $('cl-ears').value = 0; render(); save();
    });
    $('cl-bid').addEventListener('input', function () {
      st.bidFrom = String(this.value).trim() ? 'typed' : '';
      $('cl-bidsrc').textContent = st.bidFrom ? 'Your bid.' : 'Type your bid, or let the page fill one in.';
      render();
    });
    $('cl-zipgo').addEventListener('click', lookupZip);
    $('cl-zip').addEventListener('keydown', function (e) { if (e.key === 'Enter') lookupZip(); });
    $('cl-state').addEventListener('change', function () { if (st.bidFrom === 'typed') st.bidFrom = ''; if (!st.snap || !SH || !SH.nearestBid(st.snap, st.crop)) pickBid(); save(); });
    document.querySelector('.cl').addEventListener('input', function (e) {
      if (e.target.id === 'cl-bid' || e.target.id === 'cl-zip') return;
      render(); save();
    });

    loadData().then(function () {
      if (/^\d{5}$/.test($('cl-zip').value)) lookupZip(); else pickBid();
    });
    window.addEventListener('agsist:bids-net-ready', function () { if (st.zip && !st.snap) lookupZip(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
