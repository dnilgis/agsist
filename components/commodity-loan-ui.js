/* commodity-loan-ui.js: the /commodity-loan page (2026-10-16).
 *
 * The math is components/commodity-loan.js (window.AgCccLoan). Data:
 *   /data/ccc-loan.json        the monthly CCC interest rate and the list of
 *                              states with county files (written by
 *                              scripts/fetch_ccc_loan.py; may not exist yet)
 *   /data/ccc-loan/<ST>.json   one state's 2026 county loan rates, loaded
 *                              only when the reader picks that state
 * With no file, the page says so: the national 2026 rate is filled in and
 * labeled, and the interest box waits for the reader's number. Nothing is
 * filled in that the data does not carry.
 *
 * The reader's entries stay in this browser (localStorage agsist-ccc-loan).
 */
(function () {
  'use strict';
  var C = window.AgCccLoan;
  if (!C) return;
  var KEY = 'agsist-ccc-loan';
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var st = { crop: 'corn', feed: null, stateFile: null, rateFrom: '', pctFrom: '', seq: 0 };

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
  function dollars(v) { return (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function money(v) { return '$' + v.toFixed(2); }
  function cents(v, d) { return (v * 100).toFixed(d == null ? 2 : d) + '¢'; }
  function n0(v) { return Math.round(v).toLocaleString('en-US'); }
  function monthWord(ym) { var p = String(ym).split('-'); return MON[+p[1] - 1] + ' ' + p[0]; }
  function day(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
  }
  function getJSON(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }

  /* ── saved ──────────────────────────────────────────────────── */
  function save() {
    lsSet(KEY, JSON.stringify({
      crop: st.crop, bu: $('lo-bu').value, mo: $('lo-mo').value, carry: $('lo-carry').value, bank: $('lo-bank').value,
      state: $('lo-state').value, county: $('lo-county').value,
      rate: st.rateFrom === 'typed' ? $('lo-rate').value : '', pct: st.pctFrom === 'typed' ? $('lo-pct').value : ''
    }));
  }
  function restore() {
    var s = {};
    try { s = JSON.parse(lsGet(KEY) || '{}') || {}; } catch (e) { s = {}; }
    if (s.crop === 'corn' || s.crop === 'soybeans') st.crop = s.crop;
    ['bu', 'mo', 'carry', 'bank'].forEach(function (k) { if (s[k] != null && s[k] !== '') $('lo-' + k).value = s[k]; });
    if (s.rate) { $('lo-rate').value = s.rate; st.rateFrom = 'typed'; }
    if (s.pct) { $('lo-pct').value = s.pct; st.pctFrom = 'typed'; }
    st.saved = s;
  }

  /* ── loan rate ──────────────────────────────────────────────── */
  function counties() { return st.feed && st.feed.counties && st.feed.counties.states ? st.feed.counties : null; }
  function fillStates() {
    var ct = counties(), sel = $('lo-state'), cempty = $('lo-cempty');
    if (!ct) {
      sel.disabled = true;
      cempty.textContent = 'County loan rates load after the first FSA read. The national 2026 rate is filled in; your county\'s is a little above or below it, and the county FSA office has it.';
      return;
    }
    cempty.textContent = '';
    sel.disabled = false;
    var keys = Object.keys(ct.states).sort(function (a, b) { return String(ct.states[a].name).localeCompare(String(ct.states[b].name)); });
    var want = (st.saved && st.saved.state) || '';
    sel.innerHTML = '<option value="">National rate</option>' + keys.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === want ? ' selected' : '') + '>' + esc(ct.states[k].name || k) + '</option>';
    }).join('');
    if (sel.value) loadState(sel.value, st.saved && st.saved.county);
  }
  function loadState(code, wantCounty) {
    var seq = ++st.seq, cs = $('lo-county');
    st.stateFile = null;
    cs.disabled = true;
    cs.innerHTML = '<option value="">' + (code ? 'Loading…' : 'Pick a state') + '</option>';
    if (!code) { pickRate(); return; }
    getJSON('/data/ccc-loan/' + encodeURIComponent(code) + '.json').then(function (f) {
      if (seq !== st.seq) return;
      if (!f || !Array.isArray(f.counties)) {
        cs.innerHTML = '<option value="">Could not load</option>';
        $('lo-cempty').textContent = 'Could not load the county rates for that state just now. The national rate is filled in.';
        pickRate(); return;
      }
      st.stateFile = f;
      cs.disabled = false;
      cs.innerHTML = '<option value="">Pick a county</option>' + f.counties.map(function (r) {
        return '<option value="' + esc(r.county) + '"' + (r.county === wantCounty ? ' selected' : '') + '>' + esc(r.county) + '</option>';
      }).join('');
      pickRate();
    });
  }
  function pickRate() {
    var crop = st.crop, word = crop === 'corn' ? 'corn' : 'soybeans', src = $('lo-ratesrc');
    if (st.rateFrom === 'typed') { src.textContent = 'Your loan rate.'; render(); return; }
    var county = $('lo-county').value, r = county ? C.countyRate(st.stateFile, county, crop) : null;
    if (r != null) {
      $('lo-rate').value = r.toFixed(2);
      st.rateFrom = 'county';
      src.innerHTML = '2026 county loan rate for ' + esc(word) + ', ' + esc(county) + ' County, ' + esc(st.stateFile.name || st.stateFile.state) +
        ', from FSA\'s county file' + (st.stateFile.read_utc ? ', read ' + esc(day(st.stateFile.read_utc)) : '') + '.';
    } else {
      $('lo-rate').value = C.NATIONAL[crop].toFixed(2);
      st.rateFrom = 'national';
      src.textContent = (county ? 'No ' + word + ' rate for ' + county + ' County in FSA\'s file. ' : '') +
        '2026 national loan rate for ' + word + ' (FSA, Apr 8, 2026).' + (counties() ? ' Pick your county for its rate.' : '');
    }
    render();
  }

  /* ── interest rate ──────────────────────────────────────────── */
  function pickPct() {
    var src = $('lo-pctsrc'), empty = $('lo-iempty');
    var cur = C.currentRate(st.feed, new Date());
    if (st.pctFrom === 'typed') {
      src.textContent = 'Your rate.' + (cur ? ' FSA\'s posted rate for ' + monthWord(cur.month) + ' is ' + cur.pct + '%.' : '');
      empty.textContent = '';
      render(); return;
    }
    if (cur) {
      $('lo-pct').value = String(cur.pct);
      st.pctFrom = 'feed';
      src.innerHTML = 'CCC commodity loan rate for ' + esc(monthWord(cur.month)) + ', from FSA' +
        (st.feed.interest.read_utc ? ', read ' + esc(day(st.feed.interest.read_utc)) : '') + '.' +
        (cur.stale ? ' That is last month\'s; this month\'s is not read yet.' : '') + ' The rate on your loan is the one the office gives you.';
      empty.textContent = '';
    } else {
      $('lo-pct').value = '';
      st.pctFrom = '';
      src.textContent = '';
      empty.textContent = 'The CCC rate loads after the first FSA read. Until then, type the rate your county FSA office gives you.';
    }
    render();
  }

  /* ── the answer ─────────────────────────────────────────────── */
  function kv(list) { return list.map(function (x) { return '<div><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join(''); }
  function render() {
    [].forEach.call(document.querySelectorAll('[data-crop]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-crop') === st.crop)); });
    var bu = val('lo-bu', 1, 10000000), mo = val('lo-mo', 1, 9), rate = val('lo-rate', 0.5, 30), pct = val('lo-pct', 0, 20);
    var carryC = val('lo-carry', -200, 300), bank = val('lo-bank', 0, 30);
    var V = $('lo-verdict'), sub = $('lo-sub'), box = $('lo-kv'), fine = $('lo-fine'), math = $('lo-math');
    if (bu == null || rate == null || mo == null) {
      V.textContent = mo == null && bu != null && rate != null ? 'Months on the loan: 1 to 9.' : 'Enter the bushels and the loan rate.';
      sub.textContent = ''; box.innerHTML = ''; fine.textContent = ''; math.textContent = 'Enter the bushels and the loan rate.'; return;
    }
    var o = C.loan({ bu: bu, loanRate: rate, pct: pct, months: mo, carry: carryC == null ? null : carryC / 100, bankPct: bank });
    var head = dollars(o.principal) + ' now on ' + n0(bu) + ' bu at ' + money(rate) + '.';
    if (o.perBuMonth == null) {
      V.textContent = head;
      sub.textContent = 'Add the CCC interest rate to see what holding the grain on the loan costs.';
      box.innerHTML = kv([[dollars(o.principal), 'loan']]);
      fine.textContent = '';
      math.textContent = 'Loan = ' + n0(bu) + ' bu x ' + money(rate) + ' = ' + dollars(o.principal) + '\nAdd the interest rate for the rest.';
      return;
    }
    V.textContent = head + ' Interest: ' + cents(o.perBuMonth) + ' a bushel a month, ' + cents(o.perBu) + ' for ' + o.months + (o.months === 1 ? ' month.' : ' months.');
    sub.textContent = 'At ' + pct + '% a year on ' + dollars(o.principal) + ', ' + o.months + (o.months === 1 ? ' month' : ' months') + ' of interest is about ' + dollars(o.interest) + '.';
    var it = [[dollars(o.principal), 'loan'], [dollars(o.interest), 'interest, ' + o.months + ' mo'], [cents(o.perBu), 'a bushel, ' + o.months + ' mo']];
    if (o.net != null) it.push([cents(o.net), 'carry less interest, a bushel']);
    if (o.net != null) it.push([dollars(o.net * bu), 'carry less interest, all bushels']);
    if (o.saved != null) it.push([dollars(o.saved), o.saved >= 0 ? 'less than on your operating line' : 'more than on your operating line']);
    box.innerHTML = kv(it);
    var f = '';
    if (o.net != null) {
      if (o.carry <= 0) f = 'No carry: later delivery pays no more than today, so the loan only buys time.';
      else if (o.net >= 0) f = 'Your ' + cents(o.carry, 0) + ' carry covers the interest' + (o.covers != null && o.covers >= 1.5 ? ' ' + o.covers.toFixed(1) + ' times over' : '') + '. Storage, shrink and the risk of the grain going out of condition still come out of what is left.';
      else f = 'The interest is more than your ' + cents(o.carry, 0) + ' carry: holding on the loan costs more than storing pays.';
    } else f = 'Add your carry to see whether storing on the loan pays.';
    fine.textContent = f + ' Figured simple, by the month; the county office figures the real payoff.';
    math.textContent =
      'Loan = ' + n0(bu) + ' bu x ' + money(rate) + ' = ' + dollars(o.principal) + '\n' +
      'A bushel a month = ' + money(rate) + ' x ' + pct + '% / 12 = ' + cents(o.perBuMonth, 3) + '\n' +
      'For ' + o.months + ' months = ' + cents(o.perBuMonth, 3) + ' x ' + o.months + ' = ' + cents(o.perBu, 3) + '\n' +
      'Interest = ' + cents(o.perBu, 3) + ' x ' + n0(bu) + ' bu = ' + dollars(o.interest) +
      (o.net != null ? '\nCarry less interest = ' + cents(o.carry, 1) + ' - ' + cents(o.perBu, 3) + ' = ' + cents(o.net, 3) + ' a bushel' : '') +
      (o.saved != null ? '\nOperating line = ' + money(rate) + ' x ' + bank + '% / 12 x ' + o.months + ' x ' + n0(bu) + ' = ' + dollars(o.bankInterest) + '; difference ' + dollars(o.saved) : '');
  }

  /* ── wiring ─────────────────────────────────────────────────── */
  function init() {
    restore();
    var q = {};
    try { q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) {}
    var qc = String(q.crop || '').toLowerCase();
    if (qc === 'corn') st.crop = 'corn';
    if (qc === 'soybeans' || qc === 'beans' || qc === 'soybean') st.crop = 'soybeans';
    pickRate(); pickPct(); fillStates();

    [].forEach.call(document.querySelectorAll('[data-crop]'), function (b) {
      b.addEventListener('click', function () {
        st.crop = b.getAttribute('data-crop');
        if (st.rateFrom === 'typed') st.rateFrom = '';
        pickRate(); save();
      });
    });
    $('lo-rate').addEventListener('input', function () { st.rateFrom = String(this.value).trim() ? 'typed' : ''; if (!st.rateFrom) pickRate(); else { $('lo-ratesrc').textContent = 'Your loan rate.'; render(); } save(); });
    $('lo-pct').addEventListener('input', function () { st.pctFrom = String(this.value).trim() ? 'typed' : ''; pickPct(); save(); });
    $('lo-state').addEventListener('change', function () { if (st.rateFrom === 'typed') st.rateFrom = ''; st.saved = null; loadState(this.value, null); save(); });
    $('lo-county').addEventListener('change', function () { if (st.rateFrom === 'typed') st.rateFrom = ''; pickRate(); save(); });
    ['lo-bu', 'lo-mo', 'lo-carry', 'lo-bank'].forEach(function (id) { $(id).addEventListener('input', function () { render(); save(); }); });

    getJSON('/data/ccc-loan.json').then(function (f) {
      st.feed = f;
      pickPct(); fillStates();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
