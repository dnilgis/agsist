/* rate-hint.js: the custom rate going rate beside a calculator's own input (2026-10-23).
 * (data-cr-job, not data-rate: a data-rate attribute on a page with a sponsor ribbon reads as hidden price text, scripts/test_rate_card.py)
 *
 * A calculator puts one empty line where the hint belongs:
 *   <p class="rate-hint" data-cr-job="dry-corn-pt" data-for="hw-cpp" data-scale="100" data-fmt="cents"
 *      data-radio="hw-cost:point" data-what="Custom corn drying"></p>
 * data-cr-job   a job key in data/custom-rates/blend.json, or "corn:custom-farm-corn,soybeans:custom-farm-soy"
 *               with data-crop="<select id>" to follow the page's crop picker
 * data-for      the input the "Use the middle" button fills
 * data-scale    multiply the survey's dollars by this for the input's unit (100 = cents)
 * data-fmt      cents | dollars;  data-round  decimals to fill with (default 1 for cents, 2 for dollars)
 * data-radio    "name:value" of a radio to tick when the button fills the input
 * data-note     one plain sentence after the numbers (what the survey rate covers)
 * data-per      the unit in words after the middle ("a bushel a point")
 *
 * It only ever writes the input when the reader taps the button, and the same
 * button then offers to put their number back. The numbers come from the one
 * blend file /custom-rates reads; nothing here computes a rate.
 */
(function () {
  'use strict';
  var CSS = '.rate-hint{font-size:.8rem;line-height:1.5;color:var(--text-muted);margin:.45rem 0 .2rem}' +
    '.rate-hint b{color:var(--text);font-weight:700}' +
    '.rate-hint button{display:inline-flex;align-items:center;min-height:44px;margin:.25rem .5rem 0 0;padding:0 .8rem;border:1px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface));color:var(--text);font:inherit;font-size:.82rem;font-weight:700;cursor:pointer}' +
    '.rate-hint a{color:var(--link,var(--brand));text-decoration:underline;text-underline-offset:2px}' +
    '.rate-hint:empty{display:none}';
  var blend = null, wait = [];
  function load(cb) {
    if (blend) return cb(blend);
    wait.push(cb);
    if (wait.length > 1) return;
    fetch('/data/custom-rates/blend.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (b) { blend = b; var q = wait; wait = []; q.forEach(function (f) { f(b); }); })
      .catch(function () { var q = wait; wait = []; q.forEach(function (f) { f(null); }); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function homeState() {
    var s = '';
    try { s = localStorage.getItem('agsist-cr-st') || ''; } catch (e) {}
    if (!s) { try { s = (JSON.parse(localStorage.getItem('agsist-wx-loc') || 'null') || {}).state || ''; } catch (e) {} }
    return /^[A-Z]{2}$/.test(s) ? s : '';
  }
  function fmt(el, v) {
    var scale = parseFloat(el.getAttribute('data-scale') || '1'), x = v * scale;
    if (el.getAttribute('data-fmt') === 'cents') return (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '') + '¢';
    if (x < 1) return '$' + x.toFixed(3).replace(/0$/, '');
    return '$' + x.toFixed(2);
  }
  function fillValue(el, v) {
    var scale = parseFloat(el.getAttribute('data-scale') || '1');
    var dec = el.hasAttribute('data-round') ? parseInt(el.getAttribute('data-round'), 10) : el.getAttribute('data-fmt') === 'cents' ? 1 : 2;
    var x = v * scale, m = Math.pow(10, dec);
    return String(Math.round(x * m) / m);
  }
  function key(el) {
    var r = el.getAttribute('data-cr-job') || '';
    if (r.indexOf(':') < 0) return r;
    var sel = document.getElementById(el.getAttribute('data-crop') || ''), c = sel ? sel.value : '';
    var hit = r.split(',').map(function (p) { return p.split(':'); }).filter(function (p) { return p[0] === c; })[0];
    return hit ? hit[1] : '';
  }
  function span(y) { return y[0] === y[1] ? y[0] + ' rates' : y[0] + ' to ' + y[1] + ' rates'; }
  function draw(el) {
    var b = blend, k = key(el), op = b && b.ops[k];
    if (!op || !op.n) { el.innerHTML = ''; return; }
    var inp = document.getElementById(el.getAttribute('data-for'));
    var mid = op.md != null ? op.md : null, st = homeState(), s = st && b.states[st];
    if (s && s.same_as) { st = s.same_as; s = b.states[st]; }  // Delaware reads the Maryland and Delaware survey
    var what = el.getAttribute('data-what') || op.label;
    var h = '<b>' + esc(what) + ', state surveys:</b> ';
    var per = el.getAttribute('data-per') ? ' ' + esc(el.getAttribute('data-per')) : '';
    if (mid != null) h += 'middle ' + fmt(el, mid) + per + ' (' + fmt(el, op.lo) + ' to ' + fmt(el, op.hi) + ', ' + op.n + ' surveys, ' + span(op.y) + ').';
    else if (op.n === 2) h += fmt(el, op.lo) + ' to ' + fmt(el, op.hi) + ' (2 surveys, ' + span(op.y) + ', too few for a middle).';
    else { var one = Object.keys(op.by)[0]; h += fmt(el, op.by[one][0]) + ' (' + esc(b.states[one].name) + ' only, ' + span(op.y) + ').'; }
    if (s && op.by[st]) h += ' ' + esc(s.name) + '\'s ' + (s.ry !== s.year ? s.ry + ' rates' : s.year) + ' survey: ' + fmt(el, op.by[st][0]) + '.';
    if (el.getAttribute('data-note')) h += ' ' + esc(el.getAttribute('data-note'));
    var use = mid != null ? mid : (s && op.by[st] ? op.by[st][0] : null);
    if (inp && use != null) {
      var v = fillValue(el, use), back = el.getAttribute('data-back');
      h += '<br>' + (back != null && inp.value === el.getAttribute('data-put')
        ? '<button type="button" data-rh="back">Put back ' + (back === '' ? 'blank' : esc(back)) + '</button>'
        : '<button type="button" data-rh="use" data-v="' + esc(v) + '">Use ' + (mid != null ? 'the middle' : esc(s.name) + '\'s') + ', ' + esc(v) + '</button>');
    }
    h += (inp && use != null ? '' : '<br>') + '<a href="/custom-rates#' + esc(k) + '">Every state</a>';
    el.innerHTML = h;
  }
  function set(inp, v) {
    inp.value = v;
    ['input', 'change'].forEach(function (t) { inp.dispatchEvent(new Event(t, { bubbles: true })); });
  }
  function boot() {
    var els = Array.prototype.slice.call(document.querySelectorAll('.rate-hint[data-cr-job]'));
    if (!els.length) return;
    if (!document.getElementById('rate-hint-css')) { var st = document.createElement('style'); st.id = 'rate-hint-css'; st.textContent = CSS; document.head.appendChild(st); }
    load(function (b) {
      if (!b) return;
      els.forEach(function (el) {
        draw(el);
        var crop = document.getElementById(el.getAttribute('data-crop') || '');
        if (crop) crop.addEventListener('change', function () { el.removeAttribute('data-back'); setTimeout(function () { draw(el); }, 0); });
        var inp = document.getElementById(el.getAttribute('data-for'));
        if (inp) inp.addEventListener('input', function () { if (el.hasAttribute('data-back') && inp.value !== el.getAttribute('data-put')) { el.removeAttribute('data-back'); draw(el); } });
        el.addEventListener('click', function (e) {
          var btn = e.target.closest && e.target.closest('button[data-rh]');
          if (!btn || !inp) return;
          if (btn.getAttribute('data-rh') === 'use') {
            /* the reader asked for it: keep what was there so one tap puts it back */
            el.setAttribute('data-back', inp.value);
            el.setAttribute('data-put', btn.getAttribute('data-v'));
            var rd = (el.getAttribute('data-radio') || '').split(':');
            if (rd[1]) { var r = document.querySelector('input[type="radio"][name="' + rd[0] + '"][value="' + rd[1] + '"]'); if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } }
            set(inp, btn.getAttribute('data-v'));
          } else {
            var was = el.getAttribute('data-back');
            el.removeAttribute('data-back');
            set(inp, was);
          }
          draw(el);
        });
      });
    });
  }
  if (typeof window !== 'undefined') {
    window.AgRateHint = { draw: draw, fillValue: fillValue, fmt: fmt };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
