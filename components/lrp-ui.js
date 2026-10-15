/* components/lrp-ui.js: the live parts of /lrp. Math and formatting are in
 * components/lrp.js (window.AgLrp), shared with scripts/bake_lrp.mjs.
 *
 *   - today's offers: loads data/lrp/today.json when the section comes near
 *     the screen; animal, type, length, weight and head in, every coverage
 *     level's coverage price and premium after subsidy out, with the cwt math
 *     for the row picked. Dated by the sales day; says when that window has
 *     closed so yesterday's offers are never shown as today's.
 *   - each test year by year: loads data/lrp/bt.json only when opened.
 * Never sells and never routes anyone anywhere.
 */
(function () {
  'use strict';
  var L = window.AgLrp;
  var box = document.getElementById('lrp');
  if (!L || !box) return;
  var SRC = box.getAttribute('data-src') || '/data/lrp/';
  var $ = function (id) { return document.getElementById(id); };
  var esc = L.esc, money = L.money;
  var KEY = 'agsist-lrp';

  function load(name) {
    return fetch(SRC + name, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' ' + r.status);
      return r.json();
    });
  }
  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private window */ } }

  /* ---------------------------------------------------------------- offers */

  var T = null, first = {}, pickLevel = null;
  try { first = JSON.parse($('lrp-offers').getAttribute('data-first') || '{}'); } catch (e) { first = {}; }

  function offersFor(c, t) {
    return T.offers.filter(function (o) { return o.c === c && o.t === t; }).sort(function (a, b) { return a.len - b.len; });
  }

  function opt(v, text, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(text) + '</option>'; }

  function typeNote(o) {
    if (o.tested) return '';
    var fy = first[o.c + '/' + o.t];
    if (fy && +fy >= +T.ry - 1) return 'too new to test';
    return 'not in the record';
  }

  function fillProducts(s) {
    var have = {};
    T.offers.forEach(function (o) { have[o.c] = 1; });
    var h = '';
    L.PRODUCTS.forEach(function (p) { if (have[p.comm]) h += opt(p.comm, p.name, s.c === p.comm); });
    $('lrp-prod').innerHTML = h;
  }

  function fillTypes(s) {
    var c = $('lrp-prod').value, seen = {}, h = '', any = false;
    T.offers.forEach(function (o) {
      if (o.c !== c || seen[o.t]) return;
      seen[o.t] = 1;
      var n = typeNote(o);
      h += opt(o.t, L.typeName(o.c, o.t, T.ry, o.w) + (n ? ' (' + n + ')' : ''), s.t === o.t);
      if (s.t === o.t) any = true;
    });
    $('lrp-type').innerHTML = h;
    if (!any) {
      // default: the type the record tests for this animal, if offered
      var def = { '0801': '810', '0802': '820', '0815': '997' }[c];
      if (seen[def]) $('lrp-type').value = def;
    }
  }

  function fillLengths(s) {
    var list = offersFor($('lrp-prod').value, $('lrp-type').value), h = '', any = false;
    list.forEach(function (o) {
      h += opt(String(o.len), o.len + ' weeks, ends ' + L.ymdLong(o.end), +s.len === o.len);
      if (+s.len === o.len) any = true;
    });
    $('lrp-len').innerHTML = h;
    if (!any && list.length) $('lrp-len').value = String(list[0].len);
  }

  function current() {
    var c = $('lrp-prod').value, t = $('lrp-type').value, len = +$('lrp-len').value;
    var list = offersFor(c, t);
    for (var i = 0; i < list.length; i++) if (list[i].len === len) return list[i];
    return list[0] || null;
  }

  function weightDefault(o) {
    var lo = +o.w[0], hi = +o.w[1];
    return Math.round(((lo + hi) / 2) * 4) / 4;
  }

  function fmtCwt(x) { return (Math.round(x * 100) / 100).toFixed(2); }

  function render() {
    var o = current(), out = $('lrp-out');
    if (!o) { out.innerHTML = '<p class="src">No offers for this choice on this sales day.</p>'; return; }
    var cwtIn = $('lrp-cwt'), headIn = $('lrp-head');
    var s = saved(), wkey = o.c + '/' + o.t;
    if (!cwtIn.value) cwtIn.value = (s.w && s.w[wkey]) || weightDefault(o);
    var cwt = parseFloat(cwtIn.value), head = Math.floor(parseFloat(headIn.value));
    s.c = o.c; s.t = o.t; s.len = o.len; s.head = headIn.value; s.w = s.w || {}; if (cwt > 0) s.w[wkey] = cwtIn.value;
    save(s);

    var swine = o.c === '0815';
    $('lrp-wl').textContent = swine ? 'Lean weight per head, cwt' : 'Weight per head, cwt';
    var prod = L.productOf(o.c), paf = +o.paf;
    var rows = o.r.map(L.offerRow).sort(function (a, b) { return b.level - a.level; });
    if (pickLevel == null || !rows.some(function (r) { return r.level === pickLevel; })) pickLevel = rows[0].level;

    var h = '';
    var note = typeNote(o);
    if (note === 'too new to test') h += '<p class="lrp-new">RMA first offered this type in RY' + esc(first[wkey]) + '. It is too new to test: the record below does not cover it.</p>';
    else if (note) h += '<p class="lrp-new">The record below does not cover this type; it tests ' + esc(prod.name.toLowerCase()) + ' of the main type.</p>';
    var lo = +o.w[0], hi = +o.w[1];
    if (cwt > 0 && (cwt < lo - 1e-9 || cwt > hi + 1e-9)) {
      h += '<p class="lrp-new">RMA&rsquo;s target weight for this type is ' + lo.toFixed(2) + ' to ' + hi.toFixed(2) + ' cwt a head' + (swine ? ' (lean)' : '') + '.</p>';
    }
    h += '<p class="src">RMA&rsquo;s expected ending value for this type: <b>' + money(o.eev / 1000) + ' a cwt</b> on ' + esc(L.ymdLong(o.end)) + '.' +
      (o.c === '0801' && paf && paf !== 1 ? ' That already has this type&rsquo;s price adjustment factor of ' + paf.toFixed(2) + ' in it.' : '') + '</p>';
    h += '<div class="lrp-tw"><table class="lrp-t lrp-off"><thead><tr><th scope="col">Coverage</th><th scope="col">Coverage price a cwt</th>' +
      '<th scope="col">Your premium a cwt</th><th scope="col">Per head</th><th scope="col">' + (head > 0 ? head.toLocaleString('en-US') + ' head' : 'All head') + '</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var f = L.forHerd(r, cwt, head), sel = r.level === pickLevel;
      h += '<tr data-level="' + r.level + '" tabindex="0" aria-selected="' + sel + '"><th scope="row">' + L.levelPct(r.level) + '</th>' +
        '<td>' + money(r.coverage) + '</td><td>' + money(r.yourPerCwt, 3) + '</td>' +
        '<td>' + (f.premHead == null ? '' : money(f.premHead)) + '</td><td>' + (f.premAll == null ? '' : money(f.premAll, 0)) + '</td></tr>';
    });
    h += '</tbody></table></div><p class="src">Tap a row for its math. Sorted from the most coverage down.</p>';

    var r = rows.filter(function (x) { return x.level === pickLevel; })[0];
    var f = L.forHerd(r, cwt, head);
    var m = [];
    if (cwt > 0) m.push('Weight: ' + fmtCwt(cwt) + ' cwt a head (' + Math.round(cwt * 100).toLocaleString('en-US') + ' lb' + (swine ? ' lean' : '') + ')');
    m.push('Coverage at ' + L.levelPct(r.level) + ': ' + money(r.coverage) + ' a cwt' + (cwt > 0 ? ' x ' + fmtCwt(cwt) + ' cwt = ' + money(f.coverHead) + ' a head' : ''));
    m.push('Premium: RMA cost ' + money(r.fullPerCwt, 3) + ' a cwt, less ' + L.pct(r.subsidy) + ' subsidy = ' + money(r.yourPerCwt, 3) + ' a cwt');
    if (f.premHead != null) m.push('         ' + money(r.yourPerCwt, 3) + ' x ' + fmtCwt(cwt) + ' cwt = ' + money(f.premHead) + ' a head; x ' + head.toLocaleString('en-US') + ' head = ' + money(f.premAll));
    var idx = '';
    if (o.c === '0801') idx = ' (CME Feeder Cattle Index under ' + money(r.coverage / paf) + ', with the factor of ' + paf.toFixed(2) + ')';
    m.push('Pays if the ending value on ' + L.ymdLong(o.end) + ' is under ' + money(r.coverage) + ' a cwt' + idx + ',');
    m.push('the difference a cwt x ' + (cwt > 0 ? fmtCwt(cwt) + ' cwt' : 'the weight') + (head > 0 ? ' x ' + head.toLocaleString('en-US') + ' head' : '') + '.');
    h += '<div class="lrp-math" aria-label="The math for the row picked">' + esc(m.join('\n')) + '</div>';
    if (swine) h += '<p class="src">Hogs are insured at lean weight: RMA&rsquo;s worked example takes a 2.50 cwt live hog as 1.85 cwt lean (live x 0.74).</p>';
    out.innerHTML = h;
  }

  function when() {
    var el = $('lrp-when');
    var posted = T.posted || T.posted_utc || T.posted_at || null;
    var close = L.salesClose(T.sed);
    var txt = 'Offers for sales on ' + L.ymdLong(T.sed) + (posted ? ', posted by RMA ' + L.centralClock(posted) : '') + '.';
    if (L.centralNow() >= close) {
      el.className = 'lrp-when closed';
      txt += ' That sales window closed at 8:25 a.m. CT on ' + L.ymdLong(close.slice(0, 8)) + '. These prices can no longer be bought; this page shows the next ones once RMA posts them.';
    } else {
      el.className = 'lrp-when';
      txt += ' Sales close at 8:25 a.m. CT on ' + L.ymdLong(close.slice(0, 8)) + '.';
    }
    el.textContent = txt;
  }

  function start() {
    load('today.json').then(function (d) {
      T = d;
      if (!T.offers || !T.offers.length) throw new Error('no offers');
      var s = saved();
      if (s.head) $('lrp-head').value = s.head;
      fillProducts(s); fillTypes(s); fillLengths(s);
      $('lrp-ctl').hidden = false;
      $('lrp-status').textContent = '';
      when();
      render();
    }).catch(function () {
      $('lrp-status').textContent = 'Today’s offers did not load. Try again in a minute; the record below does not need them.';
    });
  }

  $('lrp-prod').addEventListener('change', function () { var s = saved(); s.t = null; $('lrp-cwt').value = ''; fillTypes(s); fillLengths(saved()); render(); });
  $('lrp-type').addEventListener('change', function () { $('lrp-cwt').value = ''; fillLengths(saved()); render(); });
  $('lrp-len').addEventListener('change', render);
  $('lrp-cwt').addEventListener('input', render);
  $('lrp-head').addEventListener('input', render);
  $('lrp-out').addEventListener('click', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-level]');
    if (!tr) return;
    pickLevel = +tr.getAttribute('data-level');
    render();
  });
  $('lrp-out').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest && e.target.closest('tr[data-level]');
    if (!tr) return;
    e.preventDefault();
    pickLevel = +tr.getAttribute('data-level');
    render();
    var again = $('lrp-out').querySelector('tr[data-level="' + pickLevel + '"]');
    if (again) again.focus();
  });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (ents) {
      if (ents.some(function (x) { return x.isIntersecting; })) { io.disconnect(); start(); }
    }, { rootMargin: '600px 0px' });
    io.observe($('lrp-offers'));
  } else start();

  /* ---------------------------------------------------------------- years */

  var yearsDone = false;
  $('lrp-years').addEventListener('toggle', function () {
    if (!this.open || yearsDone) return;
    yearsDone = true;
    $('lrp-years-status').textContent = 'Loading…';
    load('bt.json').then(function (bt) {
      var minT = bt.method.min_trials_per_year, h = '';
      bt.method.regimes.forEach(function (rg) {
        var years = {};
        Object.keys(bt.tests).forEach(function (k) {
          var t = bt.tests[k];
          if (t.regime === rg.id) Object.keys(t.years || {}).forEach(function (y) { years[y] = 1; });
        });
        var ys = Object.keys(years).sort();
        h += '<h3>' + esc(L.regimeName(bt, rg.id)) + '</h3><div class="lrp-tw"><table class="lrp-t lrp-tests"><thead><tr><th scope="col">Test</th>';
        ys.forEach(function (y) { h += '<th scope="col">RY' + y + '</th>'; });
        h += '</tr></thead><tbody>';
        L.PRODUCTS.forEach(function (p) {
          Object.keys(bt.tests).forEach(function (k) {
            var t = bt.tests[k];
            if (t.regime !== rg.id || t.product !== p.id) return;
            h += '<tr><th scope="row">' + esc(p.name + ': ' + L.testLabel(t)) + '</th>';
            ys.forEach(function (y) {
              var c = t.years && t.years[y];
              h += c && c.trials >= minT ? '<td>' + money(c.mean) + '</td>' : '<td class="na">' + (c ? c.trials + ' days' : '') + '</td>';
            });
            h += '</tr>';
          });
        });
        h += '</tbody></table></div>';
      });
      $('lrp-years-out').innerHTML = h;
      $('lrp-years-status').textContent = 'Average per $100 of coverage in each reinsurance year (July to June): the choice minus 95 to 100%, or for the first line in each animal, what 95 to 100% paid minus your premium. A year with fewer than ' + minT + ' sales days is not counted.';
    }).catch(function () {
      yearsDone = false;
      $('lrp-years-status').textContent = 'The results file did not load. Close and open this again to retry.';
    });
  });
})();
