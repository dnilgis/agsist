/* tar-spot.js: the spray break-even calculator on /tar-spot (2026-11-05).
 *
 * The math is the pure function calc() (window.AgTarSpot.calc; module.exports
 * in node for test/tar-spot.test.mjs). The page part below it only reads the
 * inputs and prints the answer with its arithmetic.
 *
 * What it answers: how many bushels an acre a pass has to save to pay for
 * itself. Cost over price, plus any bushels the application itself knocks
 * down. In second-pass mode the cost is the second pass alone and the answer
 * is bushels ABOVE what one pass already saves, never against untreated corn.
 * The optional risk line is the reader's own guess (odds and bushels saved);
 * the page never supplies or predicts either one.
 *
 * Corn price: the reader's own, or December futures for the next crop
 * (data/prices.json), or a state estimate (futures plus the state's median
 * basis, data/basis-states.json) through window.AgShrink.defaultBid
 * (components/grain-shrink.js). Each is labeled for what it is. Inputs stay
 * in this browser (localStorage agsist-tar-spot).
 */
(function (root) {
  'use strict';

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function r(v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; }

  /* o: { product, app, price, damage?, odds?, saved?, second? }
     product, app: $/acre; price: $/bu; damage: bu/acre lost to the trip
     (wheel tracks, run-down); odds: percent 0-100; saved: bu/acre the
     reader thinks the pass would save if tar spot comes in hard.
     -> null when cost or price is missing, else
        { cost, breakEven, damage, need, second, risk: null | { odds, saved,
          expectedBu, gross, net } } */
  function calc(o) {
    if (!o) return null;
    var product = num(o.product) ? o.product : null, app = num(o.app) ? o.app : null;
    if (product == null && app == null) return null;
    if (!num(o.price) || o.price <= 0) return null;
    var cost = (product || 0) + (app || 0);
    if (cost < 0) return null;
    var damage = num(o.damage) && o.damage > 0 ? o.damage : 0;
    var be = cost / o.price;
    var out = { cost: cost, breakEven: be, damage: damage, need: be + damage, second: !!o.second, risk: null };
    if (num(o.odds) && o.odds >= 0 && o.odds <= 100 && num(o.saved) && o.saved >= 0) {
      var eb = (o.odds / 100) * o.saved;
      var gross = (eb - damage) * o.price;
      out.risk = { odds: o.odds, saved: o.saved, expectedBu: eb, gross: gross, net: gross - cost };
    }
    return out;
  }

  /* The arithmetic line under the answer: "($20.00 + $12.00) / $4.00 = 8.0 bu/A". */
  function money(v) { return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function bu(v) { return r(v, 1).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function mathLine(o, res) {
    var parts = [];
    if (num(o.product)) parts.push(money(o.product));
    if (num(o.app)) parts.push(money(o.app));
    var top = parts.length > 1 ? '(' + parts.join(' + ') + ')' : parts[0];
    var s = top + ' / ' + money(o.price) + ' a bushel = ' + bu(res.breakEven) + ' bu/A';
    if (res.damage) s += ', plus ' + bu(res.damage) + ' bu/A lost to the trip = ' + bu(res.need) + ' bu/A';
    return s;
  }

  var api = { calc: calc, mathLine: mathLine, bu: bu, money: money };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgTarSpot = api;

  /* ── the page ─────────────────────────────────────────────── */
  if (typeof document === 'undefined') return;
  var KEY = 'agsist-tar-spot';
  var st = { prices: null, basis: null, priceFrom: '', mode: 'one' };
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
  function mdy(iso) {
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function medOf(n, m) { var s = 'median of ' + n + ' elevator' + (n === 1 ? '' : 's'); return typeof m !== 'number' ? s : s + ', ' + m + ' compan' + (m === 1 ? 'y' : 'ies'); }
  var IDS = ['ts-product', 'ts-app', 'ts-price', 'ts-damage', 'ts-odds', 'ts-saved', 'ts-state'];

  function save() {
    var s = { mode: st.mode, priceFrom: st.priceFrom };
    IDS.forEach(function (id) { var el = $(id); if (el) s[id] = el.value; });
    lsSet(KEY, JSON.stringify(s));
  }
  function restore() {
    var s = null;
    try { s = JSON.parse(lsGet(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') return;
    if (s.mode === 'second') st.mode = 'second';
    IDS.forEach(function (id) { var el = $(id); if (el && s[id] != null && s[id] !== '') el.value = s[id]; });
    if (s.priceFrom === 'typed') st.priceFrom = 'typed';
  }

  /* December futures for the crop a reader would spray next: from October on
     that is next year's crop. */
  function decKey(now) {
    var y = now.getUTCFullYear() + (now.getUTCMonth() >= 9 ? 1 : 0);
    return { key: 'corn-dec' + String(y).slice(2), year: y };
  }
  function setPrice(v, from, line) {
    st.priceFrom = from;
    if (v != null) $('ts-price').value = (Math.round(v * 100) / 100).toFixed(2);
    $('ts-pricesrc').textContent = line;
  }
  function pickPrice() {
    if (st.priceFrom === 'typed') { render(); return; }
    var SH = window.AgShrink, stc = $('ts-state').value;
    var d = stc && SH && st.prices && st.basis ? SH.defaultBid(st.prices, st.basis, stc, 'corn') : null;
    if (d) {
      setPrice(d.bid, 'state', 'State cash estimate, not a posted bid: ' + d.label + ' corn futures ' + money(d.futures) +
        (d.futuresDate ? ' (' + mdy(d.futuresDate) + ')' : '') + ' ' + (d.basis < 0 ? 'less' : 'plus') + ' the ' + d.stateName +
        ' basis of ' + Math.round(Math.abs(d.basis) * 100) + ' cents, ' + medOf(d.n, d.companies) + (d.asOf ? ', ' + mdy(d.asOf) : '') +
        '. Futures: CBOT, delayed.');
      render(); return;
    }
    var q = st.prices && st.prices.quotes, k = decKey(new Date()), row = q && q[k.key];
    if (row && num(row.close) && row.close > 0) {
      setPrice(row.close / 100, 'futures', 'December ' + k.year + ' corn futures, CBOT, ' +
        (row.close_kind === 'settle' ? 'settle' : 'delayed') + (row.close_date ? ' ' + mdy(row.close_date) : '') +
        '. That is a futures price, before your basis. Pick a state for a cash estimate, or type your own price.');
    } else {
      setPrice(null, '', 'No corn price loaded. Type your price.');
    }
    render();
  }
  function loadData() {
    function get(u) { return fetch(u, { cache: 'no-store' }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }); }
    return Promise.all([get('/data/prices.json'), get('/data/basis-states.json')]).then(function (a) {
      st.prices = a[0]; st.basis = a[1]; fillStates(); pickPrice();
    });
  }
  function fillStates() {
    var sel = $('ts-state'), b = st.basis && st.basis.states;
    if (!sel || !b) return;
    var cur = sel.value || '';
    if (!cur) { try { cur = (JSON.parse(lsGet('agsist-wx-loc') || 'null') || {}).state || ''; } catch (e) { cur = ''; } }
    var keys = Object.keys(b).filter(function (k) { var c = (b[k].crops || {}).corn; return c && num(c.median); })
      .sort(function (x, y) { return String(b[x].name).localeCompare(String(b[y].name)); });
    sel.innerHTML = '<option value="">December futures (no state)</option>' + keys.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(b[k].name || k) + '</option>';
    }).join('');
  }

  function render() {
    var second = st.mode === 'second';
    document.documentElement.setAttribute('data-ts', st.mode);
    [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === st.mode)); });
    var o = { product: val('ts-product', 0, 500), app: val('ts-app', 0, 500), price: val('ts-price', 0.5, 50),
      damage: val('ts-damage', 0, 100), odds: val('ts-odds', 0, 100), saved: val('ts-saved', 0, 150), second: second };
    var res = calc(o), v = $('ts-verdict'), sub = $('ts-sub'), m = $('ts-math'), rk = $('ts-risk');
    if (!res) {
      v.textContent = 'Type your cost and corn price.';
      sub.textContent = 'Example: a $32 an acre pass at $4 corn needs 8 bushels an acre to break even.';
      m.textContent = ''; rk.textContent = '';
      return;
    }
    v.textContent = bu(res.need) + ' bu/A to break even';
    sub.textContent = second ?
      'The second pass has to add ' + bu(res.need) + ' bushels an acre above what one pass already saves. Compare it with one pass, not with untreated corn.' :
      'The pass has to save ' + bu(res.need) + ' bushels an acre over untreated corn to pay for itself. That is arithmetic, not a forecast of what it will save.';
    m.textContent = mathLine(o, res);
    if (res.risk) {
      var x = res.risk;
      rk.textContent = 'Your guess: ' + r(x.odds, 0) + '% odds it comes in hard, ' + bu(x.saved) + ' bu/A saved if it does = ' + bu(x.expectedBu) + ' bu/A on average' +
        (res.damage ? ', less ' + bu(res.damage) + ' lost to the trip' : '') + '. At ' + money(o.price) + ' that is ' + money(x.gross) + ' against ' + money(res.cost) + ' of cost: ' +
        (x.net >= 0 ? money(x.net) + ' an acre ahead' : money(-x.net) + ' an acre behind') + ', on your numbers.';
    } else rk.textContent = '';
  }

  function init() {
    if (!$('ts-calc')) return;
    restore();
    [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
      b.addEventListener('click', function () { st.mode = b.getAttribute('data-mode'); render(); save(); });
    });
    ['ts-product', 'ts-app', 'ts-damage', 'ts-odds', 'ts-saved'].forEach(function (id) {
      $(id).addEventListener('input', function () { render(); save(); });
    });
    $('ts-price').addEventListener('input', function () {
      st.priceFrom = $('ts-price').value.trim() === '' ? '' : 'typed';
      $('ts-pricesrc').textContent = st.priceFrom === 'typed' ? 'Your price.' : '';
      if (st.priceFrom !== 'typed') pickPrice(); else render();
      save();
    });
    $('ts-state').addEventListener('change', function () { st.priceFrom = ''; pickPrice(); save(); });
    $('ts-pricereset').addEventListener('click', function () { st.priceFrom = ''; $('ts-price').value = ''; pickPrice(); save(); });
    render();
    if (st.priceFrom === 'typed') $('ts-pricesrc').textContent = 'Your price.';
    loadData();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof self !== 'undefined' ? self : this);
