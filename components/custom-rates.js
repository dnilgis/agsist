/* custom-rates.js: the /custom-rates page (rebuilt 2026-10-23).
 *
 * The page arrives with the going rate for every job baked in, by category
 * (scripts/build_custom_rates.py). This script adds what needs the reader:
 * their state beside the middle, a job picker and search, each state's own
 * number on tap, the cost for their acres, a sheet of picked rates to print
 * or share, and each state's full survey lines under every category.
 *
 * Data: data/custom-rates/blend.json (the going rates, every state's number
 * for each job, the rule) and data/custom-rates/<st>.json for the reader's
 * state only, loaded when it is needed. Both are built from the same survey
 * rows. This file computes nothing but the reader's own arithmetic (rate
 * times their acres); every rate is the survey's or the build's.
 */
(function () {
  'use strict';
  var KEY = 'agsist-cr-st', QKEY = 'agsist-cr-qty', SKEY = 'agsist-cr-sheet';
  var S = { b: null, st: '', k: 'combine-corn', q: '', docs: {}, loading: {}, sheet: [], qty: {} };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var SMALL = { 'bushel': 1, 'point per bushel': 1, 'gross bushel': 1, 'bushel / month': 1, 'bushel / year': 1,
    'bushel / round trip': 1, 'horsepower / hour': 1, 'bale / loaded mile': 1, 'bale': 1 };
  var ULAB = { '1,000 gallon': '1,000 gallons', 'head / day': 'head a day', 'bushel / month': 'bushel a month',
    'bushel / year': 'bushel a year', 'bushel / round trip': 'bushel, round trip', 'horsepower / hour': 'horsepower-hour',
    'hour / head row': 'hour per row of head', 'hour / foot of blade': 'hour per foot of blade',
    'hour / foot of blower': 'hour per foot of blower', 'bale / loaded mile': 'bale per loaded mile',
    'point per bushel': 'bushel per point' };
  var SHORT = { 'acre': 'an acre', 'hour': 'an hour', 'bushel': 'a bushel', 'bale': 'a bale', 'ton': 'a ton', 'mile': 'a mile',
    'loaded mile': 'a loaded mile', '1,000 gallon': 'per 1,000 gallons', 'point per bushel': 'a bushel a point', 'bushel / month': 'a bushel a month' };
  /* what the reader's own number is counted in, and a starting amount */
  var QTY = { 'acre': [500, 'acres'], 'bushel': [50000, 'bushels'], 'bale': [300, 'bales'], 'hour': [20, 'hours'],
    'ton': [200, 'tons'], 'mile': [100, 'miles'], 'loaded mile': [100, 'loaded miles'], '1,000 gallon': [500, 'thousand gallons'],
    'point per bushel': [50000, 'bushels, 5 points each'], 'bushel / month': [20000, 'bushels for a month'] };
  var PTS = 5;
  var SPREAD = { minmax: 'lowest to highest answer', trimmed: 'without the single lowest and highest answer',
    sd: 'a band of one standard deviation', none: 'no range printed' };

  function money(v, u) {
    if (v == null) return '';
    if (u === 'percent of crop') return v.toFixed(2).replace(/\.?0+$/, '') + '%';
    if (v < 1 && SMALL[u]) {
      var s = v.toFixed(3).replace(/0+$/, '');
      if (s.split('.')[1].length < 2) s = v.toFixed(2);
      return '$' + s;
    }
    if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
    return '$' + v.toFixed(2);
  }
  function dollars(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function unitLabel(u) { return u === 'percent of crop' ? 'of the crop' : 'per ' + (ULAB[u] || u); }
  function shortUnit(u) { return SHORT[u] || unitLabel(u); }
  function span(y) { return !y ? '' : y[0] === y[1] ? y[0] + ' rates' : y[0] + ' to ' + y[1] + ' rates'; }
  function stName(c) { return (S.b && S.b.names[c]) || c; }
  function yl(c) { var s = S.b.states[c]; return s.ry !== s.year ? s.ry + ' rates' : String(s.year); }

  /* ---- search (the words farmers use) ---- */
  var SYN = {
    bean: ['soybean'], soy: ['soybean'], soybean: ['soybean'],
    combin: ['combin', 'harvest'], harvest: ['harvest', 'combin'], shell: ['combin'],
    plant: ['plant'], planter: ['plant'], drill: ['drill'], seed: ['seed', 'drill', 'plant'],
    spray: ['spray', 'herbicide', 'fungicide', 'insecticide', 'chemical'], sprayer: ['spray'],
    haul: ['haul', 'truck', 'farm to market'], truck: ['truck', 'haul'], trucking: ['truck', 'haul'],
    bale: ['bale', 'baling'], baling: ['bale', 'baling'], round: ['round'],
    till: ['till', 'tillage'], tillage: ['till', 'tillage'], chisel: ['chisel'],
    disk: ['disk', 'disc'], disc: ['disk', 'disc'], nh3: ['anhydrous'], anhydrou: ['anhydrous'],
    fert: ['fertiliz'], fertiliz: ['fertiliz'], mow: ['mow'], rake: ['rak'], rak: ['rak'],
    swath: ['swath'], wheat: ['wheat', 'small grain'], oat: ['small grain', 'oat'], barley: ['small grain', 'barley'],
    dry: ['dry', 'drying'], drying: ['drying', 'dry'], drone: ['drone', 'uav'], aerial: ['aerial', 'air', 'aircraft', 'airplane'],
    plane: ['aerial', 'aircraft', 'airplane'], manure: ['manure'], lime: ['lime'], cart: ['cart'], silage: ['silage'],
    rip: ['rip', 'subsoil'], subsoil: ['subsoil', 'rip'], cultivat: ['cultivat'], dozer: ['doz', 'bulldoz'], doz: ['doz', 'bulldoz'],
    cattle: ['cattle', 'livestock'], cow: ['cattle', 'livestock'], skid: ['skid'], cover: ['cover']
  };
  function stem(w) {
    w = w.toLowerCase();
    if (w.length > 4) w = w.replace(/(ings|ing|ers|es|s)$/, '');
    if (w.length > 5) w = w.replace(/(ed|er|e)$/, '');
    return w;
  }
  function words(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); }
  function matches(q, text) {
    var qs = words(q);
    if (!qs.length) return true;
    var tw = words(text), ts = tw.map(stem), full = ' ' + tw.join(' ') + ' ';
    for (var i = 0; i < qs.length; i++) {
      var s = stem(qs[i]);
      if (s === 'per' || s === 'a' || s === 'the' || s === 'cost' || s === 'rate' || s === 'custom' || s === 'price') continue;
      var alts = SYN[s] || [s], hit = false;
      for (var j = 0; j < alts.length && !hit; j++) {
        var a = alts[j];
        if (a.indexOf(' ') >= 0) { hit = full.indexOf(' ' + a) >= 0; continue; }
        for (var k = 0; k < ts.length && !hit; k++) if (ts[k].indexOf(a) === 0 || tw[k].indexOf(a) === 0) hit = true;
      }
      if (!hit) return false;
    }
    return true;
  }
  function opText(k) {
    var op = S.b.ops[k], t = [op.label, op.u, S.b.cats.filter(function (c) { return c[0] === op.cat; })[0][1]];
    ['by', 'old', 'other'].forEach(function (g) { if (op[g]) Object.keys(op[g]).forEach(function (st) { t.push(op[g][st][4]); }); });
    return t.join(' ');
  }

  /* ---- numbers in words ---- */
  function cells(op) {
    if (op.md != null) return [money(op.md, op.u), 'middle of ' + op.n + ' surveys'];
    if (op.n === 2) return [money(op.lo, op.u) + ' to ' + money(op.hi, op.u), '2 surveys, too few for a middle'];
    if (op.n === 1) { var st = Object.keys(op.by)[0]; return [money(op.by[st][0], op.u), stName(st) + ' only']; }
    return ['', 'not in a current survey'];
  }
  function bar(op, cls, me) {
    var sts = Object.keys(op.by).sort();
    if (!sts.length) return '';
    var vals = sts.map(function (s) { return op.by[s][0]; }), top = Math.max.apply(null, vals) * 1.15;
    var pc = function (v) { return Math.round(100 * v / top); };
    var h = '<span class="' + cls + '" aria-hidden="true">';
    if (vals.length >= 2) h += '<s style="left:' + pc(Math.min.apply(null, vals)) + '%;width:' + Math.round(100 * (Math.max.apply(null, vals) - Math.min.apply(null, vals)) / top) + '%"></s>';
    sts.forEach(function (s) { h += '<i style="left:' + pc(op.by[s][0]) + '%"' + (s === me ? ' class="me"' : '') + '></i>'; });
    if (op.md != null) h += '<b style="left:' + pc(op.md) + '%"></b>';
    return h + '</span>';
  }
  /* the reader's state beside the middle, in one sentence */
  function mine(op) {
    var st = S.st, b = S.b;
    if (!st) return 'Pick your state above to see its own survey beside the middle.';
    var s = b.states[st];
    if (!s) {
      var nc = b.not_covered[st], nb = (b.borders[st] || []).filter(function (x) { return op.by[x] || (op.old && op.old[x]); });
      return 'No ' + stName(st) + ' survey here.' + (nc ? ' ' + nc : '') + (nb.length ? ' Next door: ' + nb.map(function (x) {
        var v = op.by[x] || op.old[x]; return stName(x) + ' ' + money(v[0], op.u) + ' (' + yl(x) + ')';
      }).join(', ') + '.' : '');
    }
    var v = op.by[st];
    if (v) {
      var rel = '';
      if (op.md != null && op.n >= 3) {
        var d = v[0] - op.md;
        rel = Math.abs(d) < 0.005 ? ', right at the middle' : ', ' + money(Math.abs(d), op.u) + (d > 0 ? ' over' : ' under') + ' the middle';
      }
      return stName(st) + '\'s ' + yl(st) + ' survey: ' + money(v[0], op.u) + ' ' + shortUnit(op.u) + rel + ' (' + v[3] + ' answers' + (v[1] != null ? ', ' + money(v[1], op.u) + ' to ' + money(v[2], op.u) : '') + ').';
    }
    if (op.old && op.old[st]) return stName(st) + '\'s ' + yl(st) + ' survey: ' + money(op.old[st][0], op.u) + ' ' + shortUnit(op.u) + '. Too old for the middle, so shown on its own.';
    if (op.other && op.other[st]) return stName(st) + '\'s survey prices this ' + unitLabel(op.other[st][5]) + ': ' + money(op.other[st][0], op.other[st][5]) + '. A different unit, so it is not in the middle.';
    return stName(st) + '\'s ' + yl(st) + ' survey does not price this job the same way. Its own lines are under each category below.';
  }
  function costLine(op, k) {
    var q = QTY[op.u];
    if (!q || op.n < 1) return '';
    var n = S.qty[op.u] != null ? S.qty[op.u] : q[0], f = op.u === 'point per bushel' ? PTS : 1;
    var c = function (v) { return dollars(v * n * f); };
    var mid = op.md != null ? c(op.md) + ' at the middle' : op.n === 1 ? c(op.by[Object.keys(op.by)[0]][0]) + ' at ' + stName(Object.keys(op.by)[0]) + '\'s average' : '';
    var rng = op.lo != null ? (mid ? '. ' : '') + c(op.lo) + ' to ' + c(op.hi) + ' across the states' : '';
    var me = S.st && op.by[S.st] ? '. ' + stName(S.st) + '\'s average: ' + c(op.by[S.st][0]) : '';
    return '<label class="cr-qty">For <input type="number" inputmode="numeric" min="0" step="any" data-qu="' + esc(op.u) + '" value="' + n + '" aria-label="How many ' + esc(q[1]) + '"> ' + esc(q[1]) + '</label>: ' +
      '<b>' + mid + '</b>' + rng + me + '.';
  }

  /* ---- the first-screen answer ---- */
  function hero(k) {
    var op = S.b && S.b.ops[k];
    if (!op) return;
    S.k = k;
    var c = cells(op);
    $('cr-ak').innerHTML = esc(op.label) + ' <small>' + esc(unitLabel(op.u)) + '</small>';
    $('cr-av').textContent = c[0];
    $('cr-au').textContent = shortUnit(op.u);
    $('cr-as').innerHTML = 'The ' + (op.md != null ? 'middle' : 'rate') + ' across ' + op.n + ' state survey' + (op.n === 1 ? '' : 's') + ' (' + span(op.y) + ').' +
      (op.lo != null ? ' States run ' + money(op.lo, op.u) + ' to ' + money(op.hi, op.u) + ' ' + shortUnit(op.u) + '.' : '') +
      ' <a href="#' + esc(k) + '" data-open="' + esc(k) + '">Every state</a> &middot; <a href="#how">How I figure it</a>';
    var old = $('cr-answer').querySelector('.crb-l');
    var nb = document.createElement('div'); nb.innerHTML = bar(op, 'crb crb-l', S.st);
    if (old && nb.firstChild) old.parentNode.replaceChild(nb.firstChild, old);
    $('cr-me').textContent = mine(op);
    $('cr-cost').innerHTML = costLine(op, k);
    all('.cr-chip').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-crk') === k ? 'true' : 'false'); });
  }

  /* ---- a job's detail: every state's number ---- */
  function detail(k) {
    var op = S.b.ops[k], b = S.b, nb = S.st ? (b.borders[S.st] || []) : [];
    var order = Object.keys(op.by).sort(function (x, y) {
      var w = function (s) { return s === S.st ? 0 : nb.indexOf(s) >= 0 ? 1 : 2; };
      return w(x) - w(y) || op.by[y][0] - op.by[x][0];
    });
    var row = function (s, v, cls, note, u) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + esc(stName(s)) + ' <small>' + yl(s) + (s === S.st ? ', your state' : nb.indexOf(s) >= 0 ? ', next door' : '') + '</small>' +
        '<span class="w">' + esc(v[4]) + (note ? ' <em>' + esc(note) + '</em>' : '') + '</span></th>' +
        '<td>' + money(v[0], u || op.u) + (u ? ' <small>' + esc(unitLabel(u)) + '</small>' : '') + '<span class="rgm">' + (v[1] != null ? money(v[1], u || op.u) + ' to ' + money(v[2], u || op.u) : 'no range printed') + '</span></td>' +
        '<td class="rg">' + (v[1] != null ? money(v[1], u || op.u) + ' to ' + money(v[2], u || op.u) : 'no range printed') + '</td><td>' + v[3] + '</td></tr>';
    };
    var rows = order.map(function (s) { return row(s, op.by[s], s === S.st ? 'me' : ''); });
    if (op.old) Object.keys(op.old).forEach(function (s) { rows.push(row(s, op.old[s], 'old' + (s === S.st ? ' me' : ''), 'Too old for the middle.')); });
    if (op.other) Object.keys(op.other).forEach(function (s) { rows.push(row(s, op.other[s], 'old' + (s === S.st ? ' me' : ''), 'A different unit, not in the middle.', op.other[s][5])); });
    var used = order.concat(Object.keys(op.old || {}), Object.keys(op.other || {}));
    var spreads = {};
    used.forEach(function (s) { var sp = b.states[s].spread; if (sp !== 'minmax') (spreads[sp] = spreads[sp] || []).push(stName(s)); });
    var sp = Object.keys(spreads).map(function (x) { return spreads[x].join(' and ') + ': ' + SPREAD[x]; }).join('; ');
    var none = S.st && b.states[S.st] && !used.some(function (s) { return s === S.st; }) ? '<p class="fine">' + esc(stName(S.st)) + '\'s survey does not price this job the same way. Its own lines are under each category.</p>' : '';
    var nobody = S.st && !nb.some(function (s) { return used.indexOf(s) >= 0; }) && b.states[S.st] ? '<p class="fine">No bordering state has a survey on this page yet that prices this job.</p>' : '';
    var inSheet = S.sheet.indexOf(k) >= 0;
    return '<div class="cr-tw"><table class="cr-t crd-t"><caption>Each state survey\'s average, ' + esc(unitLabel(op.u)) + '. Answers ran: the lowest and highest answer it printed.</caption>' +
      '<thead><tr><th scope="col">State and the survey\'s words</th><th scope="col">Average</th><th scope="col" class="rg">Answers ran</th><th scope="col">Answers</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table></div>' + none + nobody +
      (costLine(op, k) ? '<p class="crd-cost">' + costLine(op, k) + '</p>' : '') +
      '<p class="crd-act"><button type="button" class="cr-btn' + (inSheet ? ' on' : '') + '" data-sheet="' + esc(k) + '" aria-pressed="' + inSheet + '">' + (inSheet ? 'On my sheet' : 'Add to my sheet') + '</button>' +
      '<button type="button" class="cr-btn" data-show="' + esc(k) + '">Show at the top</button></p>' +
      '<p class="fine">' + (op.md != null ? 'The middle is the middle of these ' + op.n + ' averages; each state counts once.' : op.n === 2 ? 'Two surveys are too few for a middle, so both stand on their own.' : 'One survey prices this job.') +
      (sp ? ' Ranges differ by survey (' + esc(sp) + ').' : '') + '</p>';
  }
  function toggle(li, open) {
    var btn = li.querySelector('.cro-b'), d = li.querySelector('.cro-d'), k = li.id;
    if (open == null) open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    li.classList.toggle('open', open);
    if (open && S.b) d.innerHTML = detail(k);
    d.hidden = !open;
  }
  function refreshOpen() {
    all('.cro.open').forEach(function (li) { li.querySelector('.cro-d').innerHTML = detail(li.id); });
  }
  function markDots() {
    if (!S.b) return;
    Object.keys(S.b.ops).forEach(function (k) {
      var li = $(k); if (!li) return;
      var sts = Object.keys(S.b.ops[k].by).sort(), dots = all('.crb i', li);
      dots.forEach(function (d, i) { d.classList.toggle('me', sts[i] === S.st); });
    });
  }

  /* ---- each category's full survey lines for the reader's state ---- */
  function stateDoc(st, cb) {
    if (S.docs[st]) return cb(S.docs[st]);
    if (S.loading[st]) return S.loading[st].push(cb);
    S.loading[st] = [cb];
    fetch('/data/custom-rates/' + st.toLowerCase() + '.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { S.docs[st] = d; var q = S.loading[st]; S.loading[st] = null; q.forEach(function (f) { f(d); }); })
      .catch(function () {
        var q = S.loading[st]; S.loading[st] = null;
        status('The ' + stName(st) + ' survey did not load. Check the connection and try again, or open its page: /custom-rates/' + S.b.states[st].slug, true);
        q.forEach(function (f) { f(null); });
      });
  }
  function lineRows(d, rows) {
    return rows.map(function (r) {
      if (r.p === 'median-only') {
        return '<tr><th scope="row">' + esc(r.o) + '</th><td class="av"><span class="na">no average printed</span><span class="mdn">median ' + money(r.md, r.u) + ' ' + esc(unitLabel(r.u)) + ', few answers</span></td>' +
          '<td class="rg">not printed</td><td><span class="na">not printed</span></td></tr>';
      }
      var rg = r.lo == null ? 'not printed' : money(r.lo, r.u) + ' to ' + money(r.hi, r.u);
      return '<tr><th scope="row">' + esc(r.o) + (r.p === 'cents' ? ' <small>(printed in cents)</small>' : '') + '</th>' +
        '<td class="av">' + money(r.a, r.u) + ' <small>' + esc(unitLabel(r.u)) + '</small>' + (r.md == null ? '' : '<span class="mdn">median ' + money(r.md, r.u) + '</span>') +
        '<span class="rgm">' + (r.lo == null ? '' : 'range ' + rg) + '</span></td><td class="rg">' + rg + '</td><td>' + r.n + '</td></tr>';
    }).join('');
  }
  function stateLines(box, open) {
    var c = box.getAttribute('data-cat'), st = S.st, s = st && S.b.states[st];
    var name = S.b.cats.filter(function (x) { return x[0] === c; })[0][1];
    if (!s) { box.innerHTML = st ? '<p class="fine">No ' + esc(stName(st)) + ' survey here, so there are no state lines to add.</p>' : ''; return; }
    var head = function (n) {
      return '<button type="button" class="crc-sb" aria-expanded="' + (open ? 'true' : 'false') + '">' + (n == null ? 'Every ' + esc(name) + ' line in ' : 'All ' + n + ' ' + esc(name) + ' line' + (n === 1 ? '' : 's') + ' in ') + esc(s.name) + '\'s ' + yl(st) + ' survey</button>';
    };
    var n = s.by_cat ? s.by_cat[c] : null;
    if (n === 0) { box.innerHTML = '<p class="fine">' + esc(s.name) + '\'s survey has no ' + esc(name.toLowerCase()) + ' lines.</p>'; return; }
    if (!open) { box.innerHTML = head(n); return; }
    stateDoc(st, function (d) {
      if (!d || S.st !== st) return;
      var rows = d.rows.filter(function (r) { return r.c === c; });
      var shown = S.q ? rows.filter(function (r) { return matches(S.q, r.s + ' ' + r.o + ' ' + r.u); }) : rows;
      box.innerHTML = head(rows.length) + (shown.length ?
        '<div class="cr-tw"><table class="cr-t cr-full"><caption>' + esc(d.name) + ', ' + (d.rate_year ? d.rate_year + ' rates' : d.survey_year) + ', as the survey printed it: average' + (d.rows.some(function (r) { return r.md != null; }) ? ', median' : '') + ' and ' + esc(d.spread_label) + '. Answers = how many reported that job.</caption>' +
        '<thead><tr><th scope="col">Job</th><th scope="col">Average</th><th scope="col" class="rg">Range</th><th scope="col">Answers</th></tr></thead><tbody>' + lineRows(d, shown) + '</tbody></table></div>' +
        '<p class="fine"><a href="/custom-rates/' + esc(d.slug) + '">' + esc(d.name) + '\'s whole survey on one page</a></p>'
        : '<p class="fine">No ' + esc(d.name) + ' job matches "' + esc(S.q) + '" in this category.</p>');
    });
  }
  function allStateLines() { all('.crc-st').forEach(function (box) { stateLines(box, box.getAttribute('data-open') === '1'); }); }

  /* ---- search ---- */
  function search() {
    var q = S.q, shown = 0, first = '';
    S.b.cats.forEach(function (c) {
      var sec = $(c[0]); if (!sec) return;
      var any = 0;
      c[2].forEach(function (k) {
        var li = $(k), hit = matches(q, opText(k));
        li.hidden = !hit;
        if (hit) { any++; shown++; if (!first) first = k; }
      });
      var box = sec.querySelector('.crc-st');
      if (q && S.st && S.b.states[S.st]) { box.setAttribute('data-open', '1'); stateLines(box, true); }
      sec.classList.toggle('nohit', !!q && !any);
      if (q) openCat(sec, true);
    });
    if (q && first) hero(first);
    var stn = S.st && S.b.states[S.st] ? S.b.states[S.st].name : '';
    $('cr-count').textContent = !q ? '' : shown ? shown + ' job' + (shown === 1 ? '' : 's') + ' across states match "' + q + '"' + (stn ? '; ' + stn + '\'s own lines are under each category.' : '.') :
      'No job across states matches "' + q + '". Try one word, like combine, plant, spray, haul or bale.' + (stn ? ' ' + stn + '\'s own lines that match are below.' : '');
  }
  function openCat(sec, open) {
    var t = sec.querySelector('.crc-t');
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
    sec.classList.toggle('shut', !open);
  }

  /* ---- the reader's state ---- */
  function pickStart() {
    var u = (new URLSearchParams(location.search).get('st') || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(u) && S.b.names[u]) return u;
    var saved = lsGet(KEY);
    if (saved && S.b.names[saved]) return saved;
    var loc = null;
    try { loc = JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) {}
    var home = loc && /^[A-Z]{2}$/.test(loc.state || '') ? loc.state : '';
    return home && S.b.names[home] ? home : '';
  }
  function setState(st, quiet) {
    S.st = st;
    if (st) lsSet(KEY, st);
    $('cr-st').value = st;
    if (!quiet) url();
    markDots();
    hero(S.k);
    refreshOpen();
    allStateLines();
    if (S.q) search();
  }

  /* ---- my sheet: picked rates to print or share ---- */
  function url(extra) {
    try {
      var p = new URLSearchParams(location.search);
      ['st', 'j', 'k'].forEach(function (x) { p.delete(x); });
      if (S.st) p.set('st', S.st);
      if (S.sheet.length) p.set('j', S.sheet.join('.'));
      if (S.k !== 'combine-corn') p.set('k', S.k);
      var s = p.toString();
      if (extra) return location.origin + location.pathname + (s ? '?' + s : '');
      history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
    } catch (e) {}
    return '';
  }
  function sheetUi() {
    var n = S.sheet.length;
    $('cr-sheet').hidden = !n;
    $('cr-sheet-n').textContent = n + ' rate' + (n === 1 ? '' : 's');
    lsSet(SKEY, S.sheet.join('.'));
    url();
  }
  function sheetToggle(k) {
    var i = S.sheet.indexOf(k);
    if (i >= 0) S.sheet.splice(i, 1); else S.sheet.push(k);
    sheetUi();
    refreshOpen();
  }
  function printSpec(keys) {
    var b = S.b, st = S.st && b.states[S.st] ? S.st : '';
    var head = ['Job', 'Going rate', 'States run', 'Surveys'].concat(st ? [b.states[st].name + ' ' + yl(st)] : []);
    var row = function (k) {
      var op = b.ops[k], c = cells(op), u = ' ' + shortUnit(op.u);
      return [op.label, c[0] + u, op.lo != null ? money(op.lo, op.u) + ' to ' + money(op.hi, op.u) : '', op.n + ', ' + span(op.y)]
        .concat(st ? [op.by[st] ? money(op.by[st][0], op.u) : op.old && op.old[st] ? money(op.old[st][0], op.u) + ' (too old)' : 'not priced the same way'] : []);
    };
    var sections = keys ? [{ h: 'My rates', table: { head: head, rows: keys.map(row) } }] :
      b.cats.filter(function (c) { return c[2].length; }).map(function (c) { return { h: c[1], table: { head: head, rows: c[2].map(row) } }; });
    var used = {};
    (keys || Object.keys(b.ops)).forEach(function (k) { Object.keys(b.ops[k].by).forEach(function (s) { used[s] = 1; }); });
    var link = 'https://agsist.com/custom-rates' + (st || keys ? '?' + [st ? 'st=' + st : '', keys ? 'j=' + keys.join('.') : ''].filter(Boolean).join('&') : '');
    return {
      kicker: 'Custom farm rates', title: keys ? 'My custom rates' : 'The going rate for custom work',
      sub: 'The middle of the state custom rate surveys, ' + b.rule.oldest_in_middle + ' rates or newer' + (st ? ', with ' + b.states[st].name + '\'s own survey' : ''),
      intro: 'Going rate: the middle of the state surveys\' own averages; each state counts once; nothing inflated or adjusted. Rates are survey averages; your local custom operator may charge more or less.',
      sections: sections,
      sources: Object.keys(used).sort().map(function (s) { return { name: b.states[s].survey + ', ' + b.states[s].publisher, date: yl(s) }; }),
      url: link, page: keys ? 'My custom rates' : 'Custom farm rates'
    };
  }
  function needPrint(cb) {
    if (window.AgPrintSheet && window.AgQR) return cb();
    var n = 0, srcs = ['/components/qr.js?v=11', '/components/print-sheet.js?v=1'];
    srcs.forEach(function (src) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { if (++n === srcs.length) cb(); };
      s.onerror = function () { status('The print sheet did not load. Your browser\'s own print still works.', true); };
      document.head.appendChild(s);
    });
  }
  function doPrint(keys) { needPrint(function () { window.AgPrintSheet.print(printSpec(keys)); }); }
  function copyLink() {
    var u = url(true) || location.href;
    var done = function () { status('Link copied. It opens these rates' + (S.st ? ' with ' + stName(S.st) : '') + '.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, function () { status('Copy this link: ' + u); });
    else status('Copy this link: ' + u);
  }
  function status(msg, err) { var s = $('cr-status'); s.className = 'cr-status' + (err ? ' err' : ''); s.textContent = msg; }

  /* ---- wiring ---- */
  var OLD = { 'cr-app': 'answer', 'cr-card': 'answer', 'cr-body': 'answer', 'cr-cmp': 'answer', 'cr-st': 'answer', 'cr-q': 'answer' };
  function goHash() {
    var h = decodeURIComponent((location.hash || '').slice(1));
    if (!h) return;
    if (OLD[h]) { var a = $(OLD[h]); if (a) a.scrollIntoView(); return; }
    if (S.b.ops[h]) { var li = $(h); var sec = li.closest('.crc'); openCat(sec, true); toggle(li, true); hero(h); li.scrollIntoView(); }
    else if ($(h) && $(h).classList.contains('crc')) openCat($(h), true);
  }
  function boot() {
    if (!$('cr-cats')) return;
    var narrow = window.matchMedia && matchMedia('(max-width: 699px)').matches;
    all('.crc').forEach(function (sec) {
      sec.querySelector('.crc-t').addEventListener('click', function () { openCat(sec, sec.classList.contains('shut')); });
      if (narrow) openCat(sec, false);
    });
    fetch('/data/custom-rates/blend.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (b) {
        S.b = b;
        var sel = $('cr-st'), cov = Object.keys(b.states), rest = Object.keys(b.names).filter(function (x) { return !b.states[x]; });
        sel.innerHTML = '<option value="">Pick a state</option><optgroup label="States with a survey">' +
          cov.map(function (s) { return '<option value="' + s + '">' + esc(b.states[s].name) + ' (' + yl(s) + ')</option>'; }).join('') +
          '</optgroup><optgroup label="No survey here yet">' + rest.map(function (s) { return '<option value="' + s + '">' + esc(b.names[s]) + '</option>'; }).join('') + '</optgroup>';
        sel.addEventListener('change', function () { setState(sel.value); });
        $('cr-jobs').innerHTML = Object.keys(b.ops).map(function (k) { return '<option value="' + esc(b.ops[k].label) + '">'; }).join('');
        var qi = $('cr-q'), t = null;
        qi.addEventListener('input', function () {
          clearTimeout(t);
          t = setTimeout(function () {
            var v = qi.value.trim(), hit = Object.keys(b.ops).filter(function (k) { return b.ops[k].label.toLowerCase() === v.toLowerCase(); })[0];
            S.q = hit ? '' : v;
            search();
            if (hit) hero(hit);
          }, 140);
        });
        all('[data-crk]').forEach(function (btn) {
          btn.addEventListener('click', function () { qi.value = ''; S.q = ''; search(); hero(btn.getAttribute('data-crk')); url(); });
        });
        document.addEventListener('click', function (e) {
          var el = e.target.closest && e.target.closest('.cro-b, [data-sheet], [data-show], [data-open], .crc-sb');
          if (!el) return;
          if (el.classList.contains('cro-b')) return toggle(el.parentNode);
          if (el.hasAttribute('data-sheet')) return sheetToggle(el.getAttribute('data-sheet'));
          if (el.hasAttribute('data-show')) { hero(el.getAttribute('data-show')); url(); $('answer').scrollIntoView({ behavior: 'smooth' }); return; }
          if (el.hasAttribute('data-open')) { e.preventDefault(); var li = $(el.getAttribute('data-open')); openCat(li.closest('.crc'), true); toggle(li, true); li.scrollIntoView({ behavior: 'smooth' }); return; }
          if (el.classList.contains('crc-sb')) { var box = el.parentNode, o = box.getAttribute('data-open') !== '1'; box.setAttribute('data-open', o ? '1' : '0'); stateLines(box, o); }
        });
        document.addEventListener('input', function (e) {
          var u = e.target.getAttribute && e.target.getAttribute('data-qu');
          if (!u) return;
          var v = parseFloat(e.target.value);
          S.qty[u] = isFinite(v) && v >= 0 ? v : 0;
          lsSet(QKEY, JSON.stringify(S.qty));
          var keep = e.target, at = keep.closest('.crd-cost, .crh-cost');
          clearTimeout(keep._t);
          keep._t = setTimeout(function () {
            /* redraw the words around the box, never the box being typed in */
            all('[data-qu]').forEach(function (inp) { if (inp !== keep && inp.getAttribute('data-qu') === u) inp.value = S.qty[u]; });
            var op = S.b.ops[at.closest('.cro') ? at.closest('.cro').id : S.k];
            var tmp = document.createElement('p'); tmp.innerHTML = costLine(op);
            var nodes = Array.prototype.slice.call(at.childNodes);
            nodes.forEach(function (n) { if (n.nodeName !== 'LABEL') at.removeChild(n); });
            Array.prototype.slice.call(tmp.childNodes).forEach(function (n) { if (n.nodeName !== 'LABEL') at.appendChild(n); });
          }, 250);
        });
        $('cr-print').addEventListener('click', function () { doPrint(null); });
        $('cr-sheet-print').addEventListener('click', function () { doPrint(S.sheet.slice()); });
        $('cr-sheet-link').addEventListener('click', copyLink);
        $('cr-sheet-clear').addEventListener('click', function () { S.sheet = []; sheetUi(); refreshOpen(); });
        try { S.qty = JSON.parse(lsGet(QKEY) || '{}') || {}; } catch (e) { S.qty = {}; }
        var p = new URLSearchParams(location.search);
        var j = (p.get('j') || lsGet(SKEY) || '').split('.').filter(function (k) { return b.ops[k]; });
        S.sheet = j;
        var k = (p.get('k') || '').toLowerCase();
        if (b.ops[k]) S.k = k;
        var uq = p.get('q');
        if (uq) { qi.value = uq; S.q = uq.trim(); }
        var first = pickStart();
        S.st = first;
        sheetUi();
        setState(first, true);
        if (S.q) search();
        goHash();
        if (window.AgPrintSheet) window.AgPrintSheet.attach(function () { return S.b ? printSpec(S.sheet.length ? S.sheet.slice() : null) : null; });
      })
      .catch(function () {
        status('The going rates did not load, so your state and the per-state numbers are not shown. The rates below are as of the last build; each state\'s page still has its whole survey.', true);
      });
  }
  if (typeof window !== 'undefined') {
    window.AgCustomRates = { matches: matches, money: money, stem: stem, cells: cells };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
