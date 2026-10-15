/* components/lrp-ui.js: the live parts of /lrp. Math and formatting are in
 * components/lrp.js (window.AgLrp), shared with scripts/bake_lrp.mjs.
 *
 *   - the offers: loads data/lrp/today.json when the section comes near the
 *     screen (or the "Your premium today" button is pressed); animal, type,
 *     length, weight and head in, every coverage level's coverage price and
 *     premium after subsidy out, with the cwt math for the row picked. Dated
 *     by the sales day; re-checks every minute whether sales on those offers
 *     have closed, so a closed day's offers are never shown as open.
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
  var MAIN = { '0801': '810', '0802': '820', '0815': '997' };
  var INDEX = {
    '0801': 'the CME Feeder Cattle Index, times this type’s factor',
    '0802': 'USDA’s 5-area weekly weighted average price for slaughter steers',
    '0815': 'the CME Lean Hog Index'
  };

  function load(name) {
    return fetch(SRC + name, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' ' + r.status);
      return r.json();
    });
  }
  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private window */ } }

  /* ---------------------------------------------------------------- offers */

  var T = null, first = {}, pickLevel = null, started = false;
  try { first = JSON.parse(($('lrp-first').textContent || '{}').replace(/<!--\/?lrp:first-->/g, '')); } catch (e) { first = {}; }

  function offersFor(c, t) {
    return T.offers.filter(function (o) { return o.c === c && o.t === t; }).sort(function (a, b) { return a.len - b.len; });
  }
  function opt(v, text, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(text) + '</option>'; }

  function typeNote(o) {
    if (o.tested) return '';
    var fy = first[o.c + '/' + o.t];
    if (fy && +fy >= +T.ry - 1) return 'too new';
    return 'untested';
  }

  function typeLabel(o) {
    var n = L.typeName(o.c, o.t, T.ry, o.w);
    if (o.c === '0815' && o.t === '997') n = 'Hogs (market hogs)';
    var note = typeNote(o);
    return n + (note ? ' (' + note + ')' : '');
  }

  function fillProducts(s) {
    var h = '';
    L.PRODUCTS.forEach(function (p) { h += opt(p.comm, p.name, s.c === p.comm); });
    $('lrp-prod').innerHTML = h;
  }

  function fillTypes(s) {
    var c = $('lrp-prod').value, seen = {}, h = '', any = false;
    T.offers.slice().sort(function (a, b) { return (b.tested - a.tested) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0); }).forEach(function (o) {
      if (o.c !== c || seen[o.t]) return;
      seen[o.t] = 1;
      h += opt(o.t, typeLabel(o), s.t === o.t);
      if (s.t === o.t) any = true;
    });
    $('lrp-type').innerHTML = h;
    $('lrp-type').disabled = !h;
    if (!any && seen[MAIN[c]]) $('lrp-type').value = MAIN[c];
  }

  function fillLengths(s) {
    var list = offersFor($('lrp-prod').value, $('lrp-type').value), h = '', any = false;
    list.forEach(function (o) {
      h += opt(String(o.len), o.len + ' wk (' + L.ymdLong(o.end).replace(/, \d{4}$/, '') + ')', +s.len === o.len);
      if (+s.len === o.len) any = true;
    });
    $('lrp-len').innerHTML = h;
    $('lrp-len').disabled = !h;
    if (!any && list.length) $('lrp-len').value = String(list[0].len);
  }

  function current() {
    var c = $('lrp-prod').value, t = $('lrp-type').value, len = +$('lrp-len').value;
    var list = offersFor(c, t);
    for (var i = 0; i < list.length; i++) if (list[i].len === len) return list[i];
    return list[0] || null;
  }

  function weightDefault(o) {
    var lo = +o.w[0], hi = +o.w[1], mid = Math.round(((lo + hi) / 2) * 4) / 4;
    return o.c === '0815' ? String(Math.round((mid / L.LEAN) * 4) / 4) : String(mid);
  }

  function isClosed() { return T && L.salesDay(T).closed(new Date()); }

  function render() {
    var out = $('lrp-out'), c = $('lrp-prod').value, prod = L.productOf(c);
    var o = current();
    $('lrp-typehint').textContent = '';
    $('lrp-wnote').textContent = '';
    if (!o) {
      out.innerHTML = '<p class="lrp-new">No ' + esc(prod.name.toLowerCase()) + ' offers on this sales day. RMA does not sell cattle on USDA Cattle on Feed report days or hogs on Hogs and Pigs report days, nor on holidays.</p>';
      $('lrp-status').textContent = 'No ' + prod.name.toLowerCase() + ' offers on this sales day.';
      return;
    }
    var swine = o.c === '0815';
    $('lrp-wl').textContent = swine ? 'Live weight a head (cwt or lb)' : 'Weight a head (cwt or lb)';
    if (o.c === '0815' && o.t !== '997') {
      var lens = offersFor(o.c, o.t).map(function (x) { return x.len; });
      $('lrp-typehint').textContent = 'For pigs not yet farrowed, ' + Math.min.apply(null, lens) + ' to ' + Math.max.apply(null, lens) + ' weeks.';
    }
    var cwtIn = $('lrp-cwt'), headIn = $('lrp-head');
    var wr = L.readWeight(cwtIn.value, o.c), cwt = wr.cwt;
    var headRaw = parseFloat(String(headIn.value).replace(/,/g, ''));
    var head = headRaw > 0 ? Math.floor(headRaw) : 0;
    $('lrp-wnote').textContent = wr.note;
    var s = saved(), wkey = o.c + '/' + o.t;
    s.c = o.c; s.t = o.t; s.len = o.len; s.head = headIn.value; s.w = s.w || {}; s.w[wkey] = cwtIn.value;
    save(s);

    var problem = L.weightProblem(o, cwt, head);
    var rows = o.r.map(L.offerRow).sort(function (a, b) { return b.level - a.level; });
    if (pickLevel == null || !rows.some(function (r) { return r.level === pickLevel; })) pickLevel = rows[0].level;
    var tested = {};
    rows.forEach(function (r) { var b = L.bandOf(r.level); if (b && !tested[b]) tested[b] = r.level; });
    var closed = isClosed(), d = L.salesDay(T);

    var h = '';
    var note = typeNote(o);
    if (note === 'too new') h += '<p class="lrp-new">RMA first offered this type in insurance year ' + esc(first[wkey]) + '. It is too new to test: the record does not cover it.</p>';
    else if (note) h += '<p class="lrp-new">The record does not cover this type. For ' + esc(prod.name.toLowerCase()) + ' it tests ' + esc(L.typeName(o.c, MAIN[o.c], T.ry).toLowerCase()) + '.</p>';
    if (problem) h += '<p class="lrp-new">' + esc(problem) + '</p>';
    h += '<p class="src">RMA&rsquo;s expected ending value for this type: <b>' + money(o.eev / 1000) + ' a cwt</b> on ' + esc(L.wdShort(o.end)) + ', ' + o.end.slice(0, 4) + '.' +
      (o.c === '0801' && +o.paf !== 1 ? ' That already has this type&rsquo;s price adjustment factor of ' + (+o.paf).toFixed(2) + ' in it.' : '') + '</p>';
    var showTot = !problem && cwt != null;
    h += '<div class="lrp-tw"><table class="lrp-t lrp-off"><caption>For sales on ' + esc(d.dayShort) + (closed ? ' (closed, for reference)' : '') +
      '. Pick a level to see its math. &ldquo;Tested&rdquo; marks the level the record uses in each subsidy band.</caption><thead><tr><th scope="col">Coverage</th><th scope="col">Coverage price a cwt</th>' +
      '<th scope="col">Your premium a cwt</th><th scope="col">Per head</th><th scope="col">' + (head > 0 ? head.toLocaleString('en-US') + ' head' : 'All head') + '</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var f = L.forHerd(r, showTot ? cwt : 0, head || 1), sel = r.level === pickLevel;
      var isTested = tested[L.bandOf(r.level)] === r.level;
      h += '<tr class="' + (sel ? 'sel' : '') + '"><td class="pick"><button type="button" class="rowbtn" data-level="' + r.level + '" aria-pressed="' + sel + '">' + L.levelPct(r.level) + '</button>' +
        (isTested ? '<span class="rec">tested</span>' : '') + '</td>' +
        '<td>' + money(r.coverage) + '</td><td>' + money(r.yourPerCwt, 3) + '</td>' +
        '<td>' + (showTot && f.premHead != null ? money(f.premHead) : '') + '</td><td>' + (showTot && head > 0 && f.premHead != null ? money(f.premHead * head, 0) : '') + '</td></tr>';
    });
    h += '</tbody></table></div><p class="lrp-hint">Swipe the table sideways for the per head and total columns.</p>';

    var r = rows.filter(function (x) { return x.level === pickLevel; })[0];
    var fh = showTot ? L.forHerd(r, cwt, head || 1) : null;
    var m = [];
    if (cwt != null) m.push('Weight: ' + cwt.toFixed(2) + ' cwt a head' + (swine ? ' lean' : '') + ' (' + Math.round(cwt * 100).toLocaleString('en-US') + ' lb)');
    m.push('Coverage at ' + L.levelPct(r.level) + ': ' + money(r.coverage) + ' a cwt' + (fh ? ' x ' + cwt.toFixed(2) + ' cwt = ' + money(fh.coverHead) + ' a head' : ''));
    m.push('Premium: RMA cost ' + money(r.fullPerCwt, 3) + ' a cwt, less ' + L.pct(r.subsidy) + ' subsidy = ' + money(r.yourPerCwt, 3) + ' a cwt');
    if (fh) m.push('Your premium: ' + money(r.yourPerCwt, 3) + ' x ' + cwt.toFixed(2) + ' cwt = ' + money(fh.premHead) + ' a head' + (head > 0 ? '; x ' + head.toLocaleString('en-US') + ' head = ' + money(fh.premHead * head) : ''));
    m.push('Billed after the end date, ' + L.wdShort(o.end) + ', ' + o.end.slice(0, 4) + '.');
    var idx = o.c === '0801' && +o.paf !== 1 ? ' (index under ' + money(r.coverage / +o.paf) + ')' : '';
    m.push('Pays if, on the end date, ' + INDEX[o.c] + ' is under ' + money(r.coverage) + ' a cwt' + idx + ': the difference a cwt x the weight x the head.');
    m.push('It pays on the index, not on your sale barn or packer price.');
    h += '<div class="lrp-math" role="group" aria-label="The math for ' + L.levelPct(r.level) + ' coverage">' + esc(m.join('\n')) + '</div>';
    if (swine) h += '<p class="src">Hogs are insured at lean weight: RMA&rsquo;s worked example takes a 2.50 cwt live hog as 1.85 cwt lean (live x 0.74).</p>';
    out.innerHTML = h;
    $('lrp-status').textContent = rows.length + ' coverage levels for ' + L.typeName(o.c, o.t, T.ry, o.w).toLowerCase() + ', ' + o.len + ' weeks' + (closed ? '; sales on these offers have closed' : '') + '.';
  }

  function when() {
    var el = $('lrp-when'), cl = $('lrp-closed'), d = L.salesDay(T), now = new Date();
    el.textContent = 'Offers for sales on ' + d.dayShort + ', ' + d.day.slice(0, 4) + (d.posted ? ', posted by RMA ' + d.postedClock : '') + '. Buy by ' + d.buyBy + '.';
    var msg = '';
    if (d.closed(now)) {
      msg = 'Sales on these offers closed at ' + d.closeText + '. They can no longer be bought. RMA posts the next offers between about 2:15 and 4:30 p.m. CT on a sales day, and this page shows them within about an hour.';
    }
    if (L.isStale(T, now)) msg += (msg ? ' ' : '') + 'These are older than the last sales day: RMA may not have posted since (a holiday or report day), or this page’s update is late.';
    cl.textContent = msg;
    cl.hidden = !msg;
  }

  var lastClosed = null;
  function tick() {
    if (!T) return;
    when();
    var c = isClosed();
    if (c !== lastClosed) { lastClosed = c; if (T.offers.length) render(); }
  }

  function start() {
    if (started) return;
    started = true;
    load('today.json').then(function (d) {
      T = d;
      when();
      if (!T.offers || !T.offers.length) {
        $('lrp-status').textContent = 'RMA posted no offers for this sales day.';
        return;
      }
      var s = saved();
      if (s.head != null) $('lrp-head').value = s.head;
      fillProducts(s); fillTypes(s); fillLengths(s);
      var o = current();
      if (o) $('lrp-cwt').value = (s.w && s.w[o.c + '/' + o.t]) || weightDefault(o);
      $('lrp-ctl').hidden = false;
      $('lrp-static').hidden = true;
      lastClosed = isClosed();
      render();
      setInterval(tick, 60000);
    }).catch(function () {
      started = false;
      $('lrp-status').textContent = 'The offers did not load. Try again in a minute; the record below does not need them.';
    });
  }

  function typeChanged() {
    var o = current(), s = saved();
    $('lrp-cwt').value = o ? ((s.w && s.w[o.c + '/' + o.t]) || weightDefault(o)) : '';
  }

  $('lrp-prod').addEventListener('change', function () { var s = saved(); s.t = null; fillTypes(s); fillLengths(saved()); typeChanged(); render(); });
  $('lrp-type').addEventListener('change', function () { fillLengths(saved()); typeChanged(); render(); });
  $('lrp-len').addEventListener('change', render);
  $('lrp-cwt').addEventListener('input', render);
  $('lrp-head').addEventListener('input', render);
  $('lrp-out').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-level]');
    if (!b) return;
    pickLevel = +b.getAttribute('data-level');
    render();
    var again = $('lrp-out').querySelector('button[data-level="' + pickLevel + '"]');
    if (again) again.focus();
  });
  box.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.lrp-go')) start();
  });
  if (location.hash === '#today') start();

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
        h += '<h3>' + esc(L.regimeName(bt, rg.id)) + '</h3><div class="lrp-tw"><table class="lrp-t lrp-tests"><caption class="sr-only">Each test by insurance year</caption><thead><tr><th scope="col">Test</th>';
        ys.forEach(function (y) { h += '<th scope="col">' + y + '</th>'; });
        h += '</tr></thead>';
        L.PRODUCTS.forEach(function (p) {
          h += '<tbody><tr class="grp"><th scope="colgroup" colspan="' + (ys.length + 1) + '">' + esc(p.name) + '</th></tr>';
          Object.keys(bt.tests).forEach(function (k) {
            var t = bt.tests[k];
            if (t.regime !== rg.id || t.product !== p.id) return;
            h += '<tr><th scope="row">' + esc(L.testLabel(t)) + '</th>';
            ys.forEach(function (y) {
              var c = t.years && t.years[y];
              h += c && c.trials >= minT ? '<td>' + money(c.mean) + '</td>' : '<td class="na">' + (c ? c.trials + ' days' : '') + '</td>';
            });
            h += '</tr>';
          });
          h += '</tbody>';
        });
        h += '</table></div>';
      });
      $('lrp-years-out').innerHTML = h;
      $('lrp-years-status').textContent = 'Average in each insurance year (July to June, named by the June it ends): for a lower level, the difference from 95 to 100% per $100 of expected value; for the first line in each animal, what 95 to 100% paid minus your premium per $100 of coverage. A year with fewer than ' + minT + ' sales days is not counted.';
    }).catch(function () {
      yearsDone = false;
      $('lrp-years-status').textContent = 'The results file did not load. Close and open this again to retry.';
    });
  });
})();
