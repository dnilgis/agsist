/* components/lrp-ui.js: the live parts of /lrp and /lrp/record. Math and
 * formatting are in components/lrp.js (window.AgLrp), shared with
 * scripts/bake_lrp.mjs.
 *
 * /lrp, the calculator:
 *   - loads data/lrp/today.json at once; three inputs (animal, head, weight
 *     at sale) and a "selling around" pick of the end date. The weight picks
 *     RMA's weight class; the typed weight stays when the animal changes.
 *   - one answer: the top coverage and 95% side by side (floor, net floor,
 *     cost for the lot, a head, a cwt), the billing date, what LRP pays if
 *     the price drops by an amount the reader picks, and that month's futures
 *     close (data/prices.json) for context.
 *   - every coverage level, with the cwt math for the row picked, in a box
 *     that stays closed until opened.
 *   - the inputs ride in the URL (?a=fed&h=120&w=1400&l=13) and are restored
 *     from it, else from this browser's last visit.
 *   Dated by the sales day; re-checks every minute whether sales on those
 *   offers have closed, so a closed day's offers are never shown as open.
 * /lrp/record: each test year by year, loading data/lrp/bt.json only when
 *   opened.
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

  function load(name) {
    return fetch(SRC + name, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' ' + r.status);
      return r.json();
    });
  }

  /* ---------------------------------------------------------------- years (/lrp/record) */

  var yearsBox = $('lrp-years'), yearsDone = false;
  if (yearsBox) yearsBox.addEventListener('toggle', function () {
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

  if (!$('lrp-offers')) return;

  /* ---------------------------------------------------------------- the calculator (/lrp) */

  var KEY = 'agsist-lrp-v2';
  var INDEX = {
    '0801': 'the CME Feeder Cattle Index, times this type’s factor',
    '0802': 'USDA’s 5-area weekly weighted average price for slaughter steers',
    '0815': 'the CME Lean Hog Index'
  };
  var PAYS_ON = {
    '0801': 'the CME Feeder Cattle Index (times this type’s factor)',
    '0802': 'USDA’s 5-area weekly steer price',
    '0815': 'the CME Lean Hog Index'
  };
  var NOUN = { fed: 'fed cattle', feeder: 'feeder cattle', hogs: 'hogs' };
  var DROPS = { fed: [10, 20, 40], feeder: [10, 25, 50], hogs: [5, 10, 20] };

  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private window */ } }

  var T = null, first = {}, back = {}, prices = null, pricesAsked = false, started = false;
  var S = {}, pickLevel = null, drop = 1;
  try { first = JSON.parse(($('lrp-first').textContent || '{}').replace(/<!--\/?lrp:first-->/g, '')); } catch (e) { first = {}; }
  try { back = JSON.parse(($('lrp-back').textContent || '{}').replace(/<!--\/?lrp:back-->/g, '')); } catch (e) { back = {}; }

  function offersFor(c, t) {
    return T.offers.filter(function (o) { return o.c === c && o.t === t; }).sort(function (a, b) { return a.len - b.len; });
  }
  function opt(v, text, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(text) + '</option>'; }
  function isClosed() { return T && L.salesDay(T).closed(new Date()); }
  function num(v) { var x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return x > 0 ? x : 0; }
  function lb(cwt) { return Math.round(cwt * 100).toLocaleString('en-US'); }
  function endText(ymd) { return L.wdShort(ymd) + ', ' + ymd.slice(0, 4); }

  function typeNote(o) {
    if (o.tested) return '';
    var fy = first[o.c + '/' + o.t];
    if (fy && +fy >= +T.ry - 1) return 'too new';
    return 'untested';
  }

  /* the classes RMA offered this sales day for an animal */
  function classesNow(comm) {
    return L.classesFor(comm, T.ry).filter(function (k) {
      return T.offers.some(function (o) { return o.c === comm && k.types.indexOf(o.t) >= 0; });
    });
  }

  /* everything the inputs decide: animal, class, type, offer, weight, head */
  function resolve() {
    if (!S.a || !L.ANIMALS[S.a]) return null;
    var comm = L.ANIMALS[S.a], ks = classesNow(comm), k = null;
    ks.forEach(function (x) { if (x.id === S.k) k = x; });
    if (!k && ks.length) k = ks[0];
    var cwtIn = $('lrp-cwt'), wr = L.readWeight(cwtIn.value, comm);
    var t = L.inferType(T.offers, comm, k ? k.id : null, wr.cwt, T.ry);
    var list = t ? offersFor(comm, t) : [], o = null;
    list.forEach(function (x) { if (x.len === +S.l) o = x; });
    if (!o && list.length) {
      /* the length asked for is not offered for this type: the nearest one */
      o = list.slice().sort(function (a, b) { return Math.abs(a.len - (+S.l || 0)) - Math.abs(b.len - (+S.l || 0)); })[0];
      if (!S.l) o = list[0];
    }
    var headRaw = num(S.h);
    return { comm: comm, cls: k, classes: ks, wr: wr, cwt: wr.cwt, type: t, list: list, o: o, head: headRaw ? Math.floor(headRaw) : 0 };
  }

  function syncUrl() {
    var q = S.a ? L.toQuery({ a: S.a, h: S.h, w: S.w, l: S.l, k: S.k }) : '';
    try { history.replaceState(null, '', location.pathname + q + location.hash); } catch (e) { /* file:// or a sandbox */ }
    save({ a: S.a, h: S.h, w: S.w, l: S.l, k: S.k });
  }

  function fillInputs(R) {
    var btns = box.querySelectorAll('.lrp-animal button');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-a') === S.a));
    var len = $('lrp-len');
    if (!R || !R.list.length) { len.innerHTML = opt('', R ? 'Not offered today' : 'Pick an animal', true); len.disabled = true; }
    else {
      var h = '';
      R.list.forEach(function (o) { h += opt(String(o.len), L.ymdLong(o.end).replace(/, \d{4}$/, '') + ' (' + o.len + ' wk)', o === R.o); });
      len.innerHTML = h; len.disabled = false;
    }
    $('lrp-wl').textContent = S.a === 'hogs' ? 'Live weight at sale, lb' : 'Weight at sale, lb';
    $('lrp-cwt').placeholder = 'e.g. ' + (S.a === 'hogs' ? '280' : S.a === 'feeder' ? '750' : '1400');
    var cls = $('lrp-cls');
    if (R && R.classes.length) {
      var ch = '';
      R.classes.forEach(function (k) { ch += opt(k.id, k.name, R.cls && k.id === R.cls.id); });
      cls.innerHTML = ch; cls.disabled = R.classes.length < 2;
    } else { cls.innerHTML = opt('', R ? 'One type' : 'Pick an animal', true); cls.disabled = true; }
  }

  /* the line under the inputs: how the weight was read, and the class it picked */
  function weightNote(R) {
    var o = R.o, bits = [];
    if (R.wr.note) bits.push(esc(R.wr.note));
    if (o && R.cwt != null) {
      var name = L.typeName(o.c, o.t, T.ry, o.w);
      if (o.c === '0815' && o.t === '997') name = 'Market hogs';
      var rng = o.c === '0815' ? lb(+o.w[0] / L.LEAN) + ' to ' + lb(+o.w[1] / L.LEAN) + ' lb live'
        : lb(+o.w[0]) + ' to ' + lb(+o.w[1]) + ' lb';
      bits.push(esc(name) + ': RMA&rsquo;s class for ' + rng + (o.c === '0801' && +o.paf !== 1 ? ', priced at ' + (+o.paf).toFixed(2) + ' times the feeder index' : '') + '.');
    }
    var ch = L.carcassHint($('lrp-cwt').value, R.comm);
    if (ch) bits.push('<span class="lrp-warn">' + ch.typed + ' lb looks like a carcass weight. LRP wants live weight; RMA turns it into lean weight itself. If ' + ch.typed + ' lb is the carcass, the hog is about ' + ch.live + ' lb live. <button type="button" class="lrp-fix" data-w="' + ch.live + '">Use ' + ch.live + ' lb live</button></span>');
    return bits.join(' ');
  }

  /* why the totals are blank, or '' */
  function problemOf(R) {
    var o = R.o;
    if (R.cwt != null && R.cls) {
      var rg = L.classRange(T.offers, R.comm, R.cls.id, T.ry);
      if (rg && (R.cwt < rg[0] - 1e-9 || R.cwt > rg[1] + 1e-9)) {
        var live = R.comm === '0815';
        return 'RMA insures ' + R.cls.name.toLowerCase() + ' at a target weight of ' + (live ? lb(rg[0] / L.LEAN) + ' to ' + lb(rg[1] / L.LEAN) + ' lb live' : lb(rg[0]) + ' to ' + lb(rg[1]) + ' lb') + ', so no totals at ' + lb(R.wr.live || R.cwt) + ' lb.';
      }
    }
    var p = L.weightProblem(o, R.cwt, R.head);
    if (p && /endorsement/.test(p)) p += ' The ' + (R.comm === '0815' ? '750,000' : '25,000') + ' head a crop year counts every endorsement you buy together.';
    return p;
  }

  function rowsOf(o) { return o.r.map(L.offerRow).sort(function (a, b) { return b.level - a.level; }); }

  /* the two rows a first-time buyer compares: the top level and 95% */
  function twoRows(rows) {
    var out = [rows[0]];
    rows.forEach(function (r) { if (Math.abs(r.level - 0.95) < 1e-9 && r !== rows[0]) out.push(r); });
    return out;
  }

  function answer(R) {
    var o = R.o, rows = rowsOf(o), two = twoRows(rows), problem = problemOf(R);
    var tot = !problem && R.cwt != null && R.head > 0;
    var h = '';
    if (typeNote(o) === 'too new') h += '<p class="lrp-new">RMA first offered this type in insurance year ' + esc(first[o.c + '/' + o.t]) + '. The record does not cover it yet.</p>';
    if (problem) h += '<p class="lrp-new">' + esc(problem) + '</p>';
    var who = (R.head > 0 ? R.head.toLocaleString('en-US') + ' ' : '') + NOUN[S.a] + (R.cwt != null ? ' at ' + lb(R.wr.live || R.cwt) + ' lb' + (R.comm === '0815' ? ' live' : '') : '');
    var tw = R.cwt != null ? ' (target weight)' : '';
    h += '<p class="lrp-sum"><b>' + esc(who) + '</b>' + tw + ', insured to <b>' + esc(endText(o.end)) + '</b> (' + o.len + ' weeks).' +
      (tot ? '' : ' <span class="lrp-ask">' + (R.head > 0 ? 'Add the weight' : R.cwt != null ? 'Add the head' : 'Add head and weight') + ' for the lot.</span>') + '</p>';
    h += '<table class="lrp-two"><caption class="sr-only">' + esc(L.captionText(T, isClosed())) + ': the top coverage and 95%</caption><thead><tr><th scope="col">Coverage</th><th scope="col">Floor a ' + (R.comm === '0815' ? 'lean ' : '') + 'cwt</th><th scope="col">' +
      (tot ? 'Cost, ' + R.head.toLocaleString('en-US') + ' head' : 'Cost a cwt') + '</th></tr></thead><tbody>';
    two.forEach(function (r, i) {
      var f = tot ? L.forHerd(r, R.cwt, R.head) : null, nf = L.netFloor(r);
      h += '<tr><th scope="row">' + L.levelPct(r.level) + (i === 0 ? '<span>top offered</span>' : '') + '</th>' +
        '<td><b>' + money(r.coverage) + '</b><span>' + money(nf) + ' net</span>' + (f ? '<span>' + money(f.coverAll, 0) + ' lot</span>' : '') + '</td>' +
        '<td>' + (f ? '<b>' + money(f.premAll, 0) + '</b><span>' + money(f.premHead) + ' a head</span><span>' + money(r.yourPerCwt, 2) + ' a cwt</span>'
          : '<b>' + money(r.yourPerCwt, 2) + '</b><span>after ' + L.pct(r.subsidy) + ' from USDA</span>') + '</td></tr>';
    });
    h += '</tbody></table>';
    var bill = L.billDate(o.end);
    h += '<p class="lrp-bill">The floor is RMA&rsquo;s coverage price; net is the floor less your premium. One purchase like this is an endorsement (SCE). Nothing is due when you buy: the premium is billed <b>' + esc(L.ymdLong(bill)) + '</b>, and USDA pays ' + L.pct(two[0].subsidy) + ' of it at these levels. It pays on ' + esc(PAYS_ON[o.c]) + ', not your sale price.</p>';
    h += ifDrops(R, two, tot);
    h += '<p class="lrp-fut" id="lrp-fut"></p>';
    return h;
  }

  function ifDrops(R, two, tot) {
    var o = R.o, eev = o.eev / 1000, ds = DROPS[S.a] || DROPS.fed, d = ds[drop] != null ? ds[drop] : ds[1];
    var h = '<div class="lrp-if"><p class="lrp-ifq">If the price drops by ' + esc(L.ymdLong(o.end).replace(/, \d{4}$/, '')) + ':</p><div class="lrp-drops" role="group" aria-label="Price drop a cwt">';
    ds.forEach(function (x, i) { h += '<button type="button" data-drop="' + i + '" aria-pressed="' + (x === d) + '">$' + x + ' a cwt</button>'; });
    h += '</div><ul class="plain">';
    two.forEach(function (r) {
      var pay = L.payAt(r, eev, d);
      if (tot) {
        var all = pay * R.cwt * R.head, prem = r.yourPerCwt * R.cwt * R.head, net = all - prem;
        h += '<li><b>' + L.levelPct(r.level) + '</b> pays about <b>' + money(all, 0) + '</b>; after its premium, ' + (net >= 0 ? '<b>' + money(net, 0) + ' ahead</b>' : '<b>' + money(-net, 0) + ' behind</b>') + '.</li>';
      } else {
        h += '<li><b>' + L.levelPct(r.level) + '</b> pays about <b>' + money(pay) + ' a cwt</b>' + (pay > 0 ? '' : ': nothing') + '; its premium is ' + money(r.yourPerCwt) + ' a cwt.</li>';
      }
    });
    h += '</ul><p class="src">The drop is from RMA&rsquo;s expected ending value, ' + money(eev) + ' a cwt (its price for the end date, from futures). LRP pays if the actual ending value (the index on the end date) is under your floor. This is arithmetic on a drop you pick, not a forecast. If prices hold or rise, it pays nothing and you are out the premium.</p></div>';
    return h;
  }

  function payback(R) {
    var el = $('lrp-hist');
    var b = back[S.a] && back[S.a][R.o.len];
    if (!b) { el.textContent = 'RMA has no record yet for ' + NOUN[S.a] + ' at ' + R.o.len + ' weeks.'; return; }
    if (b.back == null) { el.textContent = 'Since July 2020, ' + NOUN[S.a] + ' at ' + R.o.len + ' weeks has ' + b.years + (b.years === 1 ? ' insurance year' : ' insurance years') + ' of record, too few to give a number (it takes ' + back.min_years + ').'; return; }
    el.innerHTML = 'Since July 2020, for ' + esc(NOUN[S.a]) + ' at the top coverage offered (95 to 100%) for ' + R.o.len + ' weeks, LRP paid back <b>' + money(b.back) + ' per $1</b> of farmer premium, over ' + b.years + ' insurance years. It paid something on ' + b.paid + ' of every 100 sales days bought.';
  }

  function futuresLine(R) {
    var el = $('lrp-fut');
    if (!el) return;
    if (!prices) { el.hidden = true; return; }
    var f = L.futuresFor(prices, R.comm, R.o.end), day = L.salesDay(T).day;
    /* a close more than four days older than the sales day is another day's market: left out */
    if (!f || f.date < L.addDays(day, -4)) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = 'For context: ' + esc(f.name) + ' ' + L.futuresStamp(f, prices.fetched).text + ', the first contract after the end date. RMA&rsquo;s expected ending value for this ' + (R.comm === '0801' && +R.o.paf !== 1 ? 'type, with its factor of ' + (+R.o.paf).toFixed(2) + ',' : 'endorsement') + ' is ' + money(R.o.eev / 1000) + '.';
  }

  /* every coverage level, with the cwt math for the row picked */
  function allLevels(R) {
    var o = R.o, rows = rowsOf(o), closed = isClosed(), cwt = R.cwt, head = R.head, swine = o.c === '0815';
    var problem = problemOf(R), showTot = !problem && cwt != null;
    if (pickLevel == null || !rows.some(function (r) { return r.level === pickLevel; })) pickLevel = rows[0].level;
    var h = '<p class="src">Net floor is the floor minus your premium. Pick a level to see its math.</p><p class="lrp-hint">Swipe the table sideways for the per head and lot columns.</p>';
    h += '<div class="lrp-tw"><table class="lrp-t lrp-off"><caption>' + esc(L.captionText(T, closed)) + '</caption><thead><tr><th scope="col">Coverage</th><th scope="col">Floor a cwt</th>' +
      '<th scope="col">Premium a cwt</th><th scope="col">Net floor a cwt</th><th scope="col">Per head</th><th scope="col">' + (head > 0 ? head.toLocaleString('en-US') + ' head' : 'All head') + '</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var f = L.forHerd(r, showTot ? cwt : 0, head || 1), sel = r.level === pickLevel;
      h += '<tr class="' + (sel ? 'sel' : '') + '"><td class="pick"><button type="button" class="rowbtn" data-level="' + r.level + '" aria-pressed="' + sel + '">' + L.levelPct(r.level) + '</button></td>' +
        '<td>' + money(r.coverage) + '</td><td>' + money(r.yourPerCwt, 3) + '</td><td>' + money(L.netFloor(r)) + '</td>' +
        '<td>' + (showTot && f.premHead != null ? money(f.premHead) : '') + '</td><td>' + (showTot && head > 0 && f.premHead != null ? money(f.premHead * head, 0) : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    var r = rows.filter(function (x) { return x.level === pickLevel; })[0];
    var fh = showTot ? L.forHerd(r, cwt, head || 1) : null;
    var m = [];
    if (cwt != null) m.push('Target weight: ' + cwt.toFixed(2) + ' cwt a head' + (swine ? ' lean' : '') + ' (' + Math.round(cwt * 100).toLocaleString('en-US') + ' lb)');
    m.push('Coverage price at ' + L.levelPct(r.level) + ': ' + money(r.coverage) + ' a cwt' + (fh ? ' x ' + cwt.toFixed(2) + ' cwt = ' + money(fh.coverHead) + ' a head' : ''));
    m.push('Premium: RMA cost ' + money(r.fullPerCwt, 3) + ' a cwt, less ' + L.pct(r.subsidy) + ' subsidy = ' + money(r.yourPerCwt, 3) + ' a cwt');
    m.push('Net floor: ' + money(r.coverage) + ' less ' + money(r.yourPerCwt, 3) + ' = ' + money(L.netFloor(r)) + ' a cwt');
    if (fh) m.push('Your premium: ' + money(r.yourPerCwt, 3) + ' x ' + cwt.toFixed(2) + ' cwt = ' + money(fh.premHead) + ' a head' + (head > 0 ? '; x ' + head.toLocaleString('en-US') + ' head = ' + money(fh.premHead * head) : ''));
    m.push('End date ' + endText(o.end) + '; billed ' + L.ymdLong(L.billDate(o.end)) + '.');
    var idx = o.c === '0801' && +o.paf !== 1 ? ' (index under ' + money(r.coverage / +o.paf) + ')' : '';
    m.push('Pays if, on the end date, ' + INDEX[o.c] + ' is under ' + money(r.coverage) + ' a cwt' + idx + ': the difference a cwt x the weight x the head.');
    m.push('It pays on the index, not on your sale barn or packer price.');
    h += '<div class="lrp-math" role="group" aria-label="The math for ' + L.levelPct(r.level) + ' coverage">' + esc(m.join('\n')) + '</div>';
    if (swine) h += '<p class="src">Hogs are insured at lean weight, 1.40 to 2.60 cwt: live weight x 0.74, so a 2.50 cwt live hog is 1.85 cwt lean (RMA LRP Handbook 2027, FCIC-20010, section 25A).</p>';
    $('lrp-all-out').innerHTML = h;
  }

  function render() {
    var out = $('lrp-out'), R = resolve(), ex = $('lrp-example');
    fillInputs(R);
    /* the dated example stands in until the reader has an answer of their own */
    if (ex) ex.hidden = !!(R && R.o);
    $('lrp-typehint').textContent = '';
    if (!R) {
      $('lrp-wnote').innerHTML = '';
      out.innerHTML = '<p class="lrp-sum lrp-ask">Pick fed cattle, feeder cattle or hogs, then enter your head and the weight you expect to sell at.</p>';
      $('lrp-hist').innerHTML = $('lrp-hist').getAttribute('data-none') || '';
      $('lrp-all-out').innerHTML = '<p class="src">Pick an animal above first.</p>';
      $('lrp-status').textContent = 'Offers loaded. Pick an animal.';
      return;
    }
    var prod = L.productOf(R.comm), o = R.o;
    $('lrp-wnote').innerHTML = weightNote(R);
    if (!o) {
      out.innerHTML = '<p class="lrp-new">No ' + esc(prod.name.toLowerCase()) + ' offers on this sales day. RMA does not sell cattle on USDA Cattle on Feed report days or hogs on Hogs and Pigs report days, nor on holidays.</p>';
      $('lrp-all-out').innerHTML = '';
      $('lrp-status').textContent = 'No ' + prod.name.toLowerCase() + ' offers on this sales day.';
      return;
    }
    if (o.c === '0815' && o.t !== '997') {
      var lens = offersFor(o.c, o.t).map(function (x) { return x.len; });
      $('lrp-typehint').textContent = 'For pigs not yet farrowed, ' + Math.min.apply(null, lens) + ' to ' + Math.max.apply(null, lens) + ' weeks.';
    }
    out.innerHTML = answer(R);
    futuresLine(R);
    payback(R);
    allLevels(R);
    $('lrp-status').textContent = o.r.length + ' coverage levels for ' + L.typeName(o.c, o.t, T.ry, o.w).toLowerCase() + ', ' + o.len + ' weeks' + (isClosed() ? '; sales on these offers have closed' : '') + '.';
  }

  function when() {
    var el = $('lrp-when'), cl = $('lrp-closed'), d = L.salesDay(T), now = new Date();
    el.textContent = L.whenText(T);
    var msg = d.closed(now) ? L.closedText(T) : '';
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

  function loadPrices() {
    if (pricesAsked) return;
    pricesAsked = true;
    fetch('/data/prices.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { prices = d; if (T && T.offers.length) render(); })
      .catch(function () { /* the futures line is context only */ });
  }

  function start() {
    if (started) return;
    started = true;
    $('lrp-hist').setAttribute('data-none', $('lrp-hist').innerHTML);
    load('today.json').then(function (d) {
      T = d;
      when();
      if (!T.offers || !T.offers.length) {
        $('lrp-status').textContent = 'RMA posted no offers for this sales day.';
        return;
      }
      /* the URL first (a shared link), else this browser's last visit */
      var q = L.parseQuery(location.search);
      S = q.a ? q : saved();
      if (!L.ANIMALS[S.a]) S = { h: S.h, w: S.w };
      $('lrp-head').value = S.h || '';
      $('lrp-cwt').value = S.w || '';
      $('lrp-ctl').hidden = false;
      $('lrp-static').hidden = true;
      $('lrp-status').classList.add('sr-only');
      lastClosed = isClosed();
      render();
      if (S.a) syncUrl();
      loadPrices();
      setInterval(tick, 60000);
    }).catch(function () {
      started = false;
      $('lrp-status').textContent = 'The offers did not load. Try again in a minute; the record on /lrp/record does not need them.';
    });
  }

  function changed() { render(); syncUrl(); }

  box.querySelector('.lrp-animal').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-a]');
    if (!b || !T) return;
    /* the head and the typed weight stay; class and length follow the animal */
    S = L.switchAnimal(S, b.getAttribute('data-a'));
    drop = 1;
    changed();
  });
  $('lrp-cls').addEventListener('change', function () { S.k = this.value; changed(); });
  $('lrp-len').addEventListener('change', function () { S.l = +this.value; changed(); });
  $('lrp-cwt').addEventListener('input', function () { S.w = this.value.trim(); changed(); });
  $('lrp-head').addEventListener('input', function () { S.h = this.value.trim(); changed(); });
  $('lrp-wnote').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-w]');
    if (!b) return;
    S.w = b.getAttribute('data-w');
    $('lrp-cwt').value = S.w;
    changed();
  });
  $('lrp-out').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-drop]');
    if (!b) return;
    drop = +b.getAttribute('data-drop');
    render();
    var again = $('lrp-out').querySelector('button[data-drop="' + drop + '"]');
    if (again) again.focus();
  });
  $('lrp-all-out').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-level]');
    if (!b) return;
    pickLevel = +b.getAttribute('data-level');
    var R = resolve();
    if (R && R.o) allLevels(R);
    var again = $('lrp-all-out').querySelector('button[data-level="' + pickLevel + '"]');
    if (again) again.focus();
  });
  start();
})();
