/* components/cb-vs-state.js: one line under the best prices on /cash-bids,
   "Corn basis here vs your state": the middle basis of the elevators in this
   search against the middle of every AGSIST network elevator in the searched
   ZIP's state (data/basis-states.json, scripts/basis_method.py).
   Like for like or nothing: each elevator counts once, at the nearest bid the
   page itself ranks (getNearestBid: no past months, no unusual basis, no
   special grade), and only when that bid is on the same futures contract the
   state middle is against. Fewer than 3 such elevators, a state file older
   than 10 days, a month filter, or no state for the ZIP: no line.
   cash-bids.js calls CBVsState.draw(elevators, {nearest, cents, contract,
   zip, crop, delivery}). Tests: test/cb-vs-state.test.mjs. */
(function (root) {
  'use strict';
  var Z3 = '005NY006--010MA028RI030NH039ME050VT055MA056VT060CT070NJ090--100NY150PA197DE200DC201VA202DC206MD220VA247WV270NC290SC300GA320FL340--341FL350AL370TN386MS398GA400KY430OH460IN480MI500IA530WI550MN569DC570SD580ND590MT600IL630MO660KS680NE700LA716AR730OK733TX734OK750TX800CO820WY832ID840UT850AZ870NM885TX889NV900CA962--967HI969--970OR980WA995AK';
  var FR = { 0: '', 25: '¼', 50: '½', 75: '¾' }, MIN = 3;
  var CROPS = [['corn', 'Corn'], ['soybeans', 'Soybean']];
  function zipState(zip) {
    if (!/^\d{5}$/.test(zip || '')) return '';
    var p = +zip.slice(0, 3), st = '';
    for (var i = 0; i < Z3.length; i += 5) { if (+Z3.substr(i, 3) > p) break; st = Z3.substr(i + 3, 2); }
    return st === '--' ? '' : st;
  }
  function med(a) { var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; }
  function qc(c) { var q = Math.round(Math.abs(c) * 4) / 4, w = Math.floor(q), f = Math.round((q - w) * 100); return (w || !f ? String(w) : '') + FR[f]; }
  function words(c) { return Math.abs(c) < 0.125 ? 'even with' : qc(c) + '¢ ' + (c < 0 ? 'under' : 'over'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ct(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(d); } catch (e) { return ''; }
  }

  /* -> [{crop, label, n, search (c), state (c), stateN, diff (c), name, contract, asOf, path}] */
  function compute(elevators, o, bs, now) {
    var st = zipState(o.zip), s = bs && bs.states && st ? bs.states[st] : null, out = [];
    if (!s || !bs.generated || ((now || Date.now()) - Date.parse(bs.generated)) / 864e5 > 10 || (o.delivery && o.delivery !== 'all')) return out;
    CROPS.forEach(function (c) {
      if (o.crop && o.crop !== 'all' && o.crop !== c[0]) return;
      var r = s.crops && s.crops[c[0]];
      if (!r || typeof r.median !== 'number' || !isFinite(r.median) || !r.contract) return;
      var vals = [];
      (elevators || []).forEach(function (e) {
        var b = o.nearest(e, c[0]);
        if (!b || b.basis == null || b._odd || o.contract(b) !== r.contract) return;
        var v = o.cents(b.basis, b);
        if (v != null && isFinite(v)) vals.push(v);
      });
      if (vals.length < MIN) return;
      var m = med(vals), sm = Math.round(r.median * 1e4) / 100;
      out.push({ crop: c[0], label: c[1], n: vals.length, search: m, state: sm, stateN: r.n, diff: Math.round((m - sm) * 4) / 4,
        name: s.name || st, contract: r.label || r.contract, asOf: bs.generated, path: s.path || '' });
    });
    return out;
  }
  function html(rows) {
    if (!rows.length) return '';
    var r0 = rows[0];
    return rows.map(function (r) {
      var d = r.diff, cmp = Math.abs(d) < 0.125 ? 'even with' : qc(d) + '¢ ' + (d > 0 ? 'stronger than' : 'weaker than');
      return '<b>' + r.label + ' basis here vs ' + esc(r.name) + ':</b> the middle of ' + r.n + ' elevators in this search is ' + words(r.search) + ' ' + esc(r.contract) +
        ', ' + cmp + ' the ' + esc(r.name) + ' middle (' + words(r.state) + ', ' + r.stateN + ' elevators).';
    }).join('<br>') + ' <span class="cb-vs-s">Each elevator once, at its nearest bid on the same futures month. State middle as of ' + ct(r0.asOf) +
      (r0.path ? ', <a href="' + esc(r0.path) + '">' + esc(r0.name) + ' basis</a>' : '') + '.</span>';
  }

  var api = { zipState: zipState, compute: compute, html: html };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  var BS = null, asked = false, last = null;
  var css = root.document.createElement('style');
  css.textContent = '#cb-vs-state{margin:.5rem 0 0;padding:.5rem .7rem;border-left:3px solid var(--green);background:var(--surface);border-radius:6px;font-size:.84rem;line-height:1.5;color:var(--text-dim)}#cb-vs-state b{color:var(--text)}#cb-vs-state .cb-vs-s{display:block;margin-top:.2rem;font-size:.74rem;color:var(--text-muted)}#cb-vs-state a{color:var(--gold)}';
  root.document.head.appendChild(css);
  function load() {
    if (asked) return;
    asked = true;
    var p = root.AG && typeof root.AG.json === 'function' ? root.AG.json('/data/basis-states.json') : fetch('/data/basis-states.json').then(function (r) { return r.ok ? r.json() : null; });
    p.then(function (j) { BS = j; if (last) draw(last[0], last[1]); }).catch(function () {});
  }
  function draw(elevators, o) {
    last = [elevators, o];
    var el = root.document.getElementById('cb-vs-state');
    if (!el) return;
    if (!BS) { load(); el.hidden = true; return; }
    var h = html(compute(elevators, o, BS));
    el.innerHTML = h;
    el.hidden = !h;
  }
  api.draw = draw;
  root.CBVsState = api;
})(typeof window !== 'undefined' ? window : this);
