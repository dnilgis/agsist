/* custom-rates.js: the /custom-rates page (rebuilt 2026-10-23; quote my job, a state rate sheet,
 * the diesel line and the new-survey email added Nov 3).
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
  var S = { b: null, st: '', k: 'combine-corn', q: '', docs: {}, loading: {}, sheet: [], qty: {}, quote: [] };

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
    sd: 'a band of one standard deviation', none: 'no range printed', mid80: 'the middle 80 percent of answers' };
  /* a survey's range in a sentence, named for what it is (the builder's SPREAD_WORDS) */
  var SPW = { minmax: ['answers ran', 'to'], trimmed: ['trimmed range (lowest and highest answer left out)', 'to'],
    sd: ['most answers fell between', 'and'], mid80: ['middle 80% of answers', 'to'] };
  /* the short mark beside a range that is not the lowest and highest answer */
  var SPTAG = { trimmed: 'trimmed', sd: 'most answers', mid80: 'middle 80%' };

  /* decimals a number prints with, and the number rounded half up the way it prints (the builder's half_up) */
  function places(v, u) { return u === 'percent of crop' ? 2 : v < 1 && SMALL[u] ? 3 : v >= 1000 ? 0 : 2; }
  function halfUp(v, p) { var f = Math.pow(10, p); return Math.round(Number((Math.abs(v) * f).toFixed(6))) / f * (v < 0 ? -1 : 1); }
  function shown(v, u) { return halfUp(v, places(v, u)); }
  function money(v, u) {
    if (v == null) return '';
    var r = shown(v, u);
    if (u === 'percent of crop') return r.toFixed(2).replace(/\.?0+$/, '') + '%';
    if (v < 1 && SMALL[u]) {
      var s = r.toFixed(3).replace(/0+$/, '');
      if (s.split('.')[1].length < 2) s = r.toFixed(2);
      return '$' + s;
    }
    if (v >= 1000) return '$' + r.toLocaleString('en-US');
    return '$' + r.toFixed(2);
  }
  /* 'Nebraska is $7.42 over it', from the two numbers as printed */
  function overUnder(a, b, u, who, it) {
    var d = Math.round((shown(a, u) - shown(b, u)) * 1e6) / 1e6;
    return d === 0 ? who + ' right at ' + it : who + ' ' + money(Math.abs(d), u) + (d > 0 ? ' over ' : ' under ') + it;
  }
  function rangeWords(lo, hi, u, sp) {
    if (lo == null) return 'no range printed';
    var w = SPW[sp] || SPW.minmax;
    return w[0] + ' ' + money(lo, u) + ' ' + w[1] + ' ' + money(hi, u);
  }
  function dollars(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function unitLabel(u) { return u === 'percent of crop' ? 'of the crop' : 'per ' + (ULAB[u] || u); }
  function shortUnit(u) { return SHORT[u] || unitLabel(u); }
  function span(y) { return !y ? '' : y[0] === y[1] ? y[0] + ' rates' : y[0] + ' to ' + y[1] + ' rates'; }
  function stName(c) { var s = S.b && S.b.states[c]; return (s && !s.same_as && s.name) || (S.b && S.b.names[c]) || c; }
  /* the survey a state reads: Delaware reads the Maryland and Delaware survey */
  function sv(c) { var s = S.b && c && S.b.states[c]; return s && s.same_as ? s.same_as : c; }
  function yl(c) { var s = S.b.states[sv(c)]; return s.ry !== s.year ? s.ry + ' rates' : String(s.year); }
  /* the one year rule in a sentence: '2026 survey of 2025 rates', else '2026 survey' */
  function svy(c) { var s = S.b.states[sv(c)]; return s.ry !== s.year ? s.year + ' survey of ' + s.ry + ' rates' : s.year + ' survey'; }
  /* how far a hauling rate carries the grain, unless the survey's own words already say it */
  function basisOf(op, st, words) {
    var t = op.basis && op.basis[st];
    if (!t) return '';
    var nums = t.match(/\d+(\.\d+)?/g);
    return nums && nums.every(function (n) { return words.indexOf(n) >= 0; }) ? '' : t;
  }
  function ans(n) { return n == null ? 'answers not printed' : n + ' answers'; }
  /* what owning and running the machine costs (machinery cost estimates), beside the going rate; never in the middle */
  function diy(k, op) {
    var out = [];
    (S.b.diy || []).forEach(function (d) {
      var v = d.ops[k]; if (!v) return;
      var mon = d.published.split('-'), when = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mon[1] - 1] + ' ' + mon[0];
      var cmp = op.md != null ? ' ' + overUnder(op.md, v[0], op.u, 'The going rate is', 'it') + '.' : '';
      out.push('Doing it yourself: ' + money(v[0], v[1]) + ' ' + shortUnit(v[1]) + ' (' + d.name + ', ' + when + ', ' + v[2].toLowerCase() + '). That is the cost to own and run the machine, not a rate anyone charged.' + cmp);
    });
    return out;
  }

  /* ---- search (the words farmers use) ---- */
  var SYN = {
    bean: ['soybean'], soy: ['soybean'], soybean: ['soybean'],
    combin: ['combin', 'harvest'], harvest: ['harvest', 'combin'], shell: ['combin'],
    plant: ['plant'], planter: ['plant'], drill: ['drill'], seed: ['seed', 'drill', 'plant'],
    spray: ['spray', 'herbicide', 'fungicide', 'insecticide', 'chemical'], sprayer: ['spray'],
    haul: ['haul', 'truck', 'farm to market'], truck: ['truck', 'haul'], trucking: ['truck', 'haul'],
    bale: ['bale', 'baling'], baling: ['bale', 'baling'], round: ['round'],
    till: ['till', 'tillage'], tillage: ['till', 'tillage'], chisel: ['chisel'],
    /* stem('tiling') is 'til', which would prefix-match tillage: tile drainage has its own words (Nov 13) */
    til: ['tiling', 'tile'], tile: ['tile', 'tiling'], tiling: ['tiling', 'tile'],
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
    /* the scale, said out loud: zero at the left, the bar's top value at the right (same as the builder) */
    h += '<em class="crb-0">$0</em><em class="crb-t">' + money(top, op.u) + '</em>';
    return h + '</span>';
  }
  /* the reader's survey's own number for a job: [values, unit, kind] or null */
  function stateVal(op) {
    var st = sv(S.st);
    if (!st || !S.b.states[st]) return null;
    if (op.by[st]) return [op.by[st], op.u, 'by'];
    if (op.old && op.old[st]) return [op.old[st], op.u, 'old'];
    if (op.apart && op.apart[st]) return [op.apart[st], op.u, 'apart'];
    if (op.other && op.other[st]) return [op.other[st], op.other[st][5], 'other'];
    return null;
  }
  /* 'Nebraska's 2026 survey', or the shared survey Delaware reads */
  function whose() {
    var b = S.b, st0 = S.st, st = sv(S.st), s = b.states[st];
    return st0 !== st ? 'The ' + s.name + ' ' + svy(st) + ', which ' + b.names[st0] + ' shares' : stName(st) + '\'s ' + svy(st);
  }
  /* the reader's state when it has no number of its own for this job */
  function mine(op) {
    var b = S.b, st = sv(S.st);
    if (!st) return null;
    if (!b.states[st]) {
      var nc = b.not_covered[st], nb = (b.borders[st] || []).filter(function (x) { return op.by[x] || (op.old && op.old[x]); });
      return 'No ' + stName(st) + ' survey here.' + (nc ? ' ' + nc : '') + (nb.length ? ' Next door: ' + nb.map(function (x) {
        var v = op.by[x] || op.old[x]; return stName(x) + ' ' + money(v[0], op.u) + ' (' + yl(x) + ')';
      }).join(', ') + '.' : '');
    }
    return whose() + ' does not price this job the same way. Its own lines are under each category below.';
  }
  /* the middle across the states, in one sentence, with the reader's state against it */
  function middleLine(op, me) {
    var u = op.u, st = sv(S.st), who = me ? stName(st) + ' is' : '';
    var t = op.md != null ? 'Middle of ' + op.n + ' state surveys: ' + money(op.md, u) + ' ' + shortUnit(u) + ' (' + span(op.y) + ')' +
      (me && me[2] === 'by' ? '; ' + overUnder(me[0][0], op.md, u, who, 'it') : '') + '.' :
      op.n === 2 ? 'Two current surveys price it the same way, too few for a middle.' : op.n === 1 ? 'One current survey prices it.' : 'No current survey prices it the same way.';
    if (op.lo != null) t += ' States run ' + money(op.lo, u) + ' to ' + money(op.hi, u) + ' ' + shortUnit(u) + '.';
    if (op.basis) t += ' States measure different distances: ' + Object.keys(op.basis).map(function (x) { return x + ' ' + op.basis[x]; }).join('; ') + '.';
    return t;
  }
  function costLine(op, k) {
    var q = QTY[op.u];
    if (!q || op.n < 1) return '';
    var n = S.qty[op.u] != null ? S.qty[op.u] : q[0], f = op.u === 'point per bushel' ? PTS : 1;
    var c = function (v) { return dollars(shown(v, op.u) * n * f); };
    var me = S.st && op.by[sv(S.st)] ? op.by[sv(S.st)][0] : null;
    var head = me != null ? c(me) + ' at ' + stName(sv(S.st)) + '\'s average' :
      op.md != null ? c(op.md) + ' at the middle' : op.n === 1 ? c(op.by[Object.keys(op.by)[0]][0]) + ' at ' + stName(Object.keys(op.by)[0]) + '\'s average' : '';
    var mid = me != null && op.md != null ? '. ' + c(op.md) + ' at the middle' : '';
    var rng = op.lo != null ? (head ? '. ' : '') + c(op.lo) + ' to ' + c(op.hi) + ' across the states' : '';
    return '<label class="cr-qty">For <input type="number" inputmode="numeric" min="0" step="any" data-qu="' + esc(op.u) + '" value="' + n + '" aria-label="How many ' + esc(q[1]) + '"> ' + esc(q[1]) + '</label>: ' +
      '<b>' + head + '</b>' + mid + rng + '.';
  }

  /* ---- the first-screen answer: the reader's own state first (Nov 3), the middle under it ---- */
  function hero(k) {
    var op = S.b && S.b.ops[k];
    if (!op) return;
    S.k = k;
    var me = stateVal(op), u = me ? me[1] : op.u, c = cells(op), st = sv(S.st);
    $('cr-ak').innerHTML = esc(op.label) + ' <small>' + esc(unitLabel(u)) + '</small>';
    var links = ' <a href="#' + esc(k) + '" data-open="' + esc(k) + '">Every state</a> &middot; <a href="#how">How I figure it</a>';
    if (me) {
      var v = me[0], rw = rangeWords(v[1], v[2], u, S.b.states[st].spread), basis = basisOf(op, st, v[4]) ? ' (' + basisOf(op, st, v[4]) + ')' : '';
      $('cr-av').textContent = money(v[0], u);
      $('cr-au').textContent = shortUnit(u);
      $('cr-as').textContent = whose() + ', “' + v[4] + '”' + basis + ': ' + (v[3] == null ? 'Answers not printed' : ans(v[3])) + '. ' + rw.charAt(0).toUpperCase() + rw.slice(1) + '.' +
        (me[2] === 'old' ? ' Too old for the middle, so shown on its own.' : me[2] === 'apart' ? ' Not in the middle: ' + v[5] + '.' : me[2] === 'other' ? ' A different unit, so it is not in the middle.' : '');
      $('cr-me').innerHTML = esc(middleLine(op, me)) + links;
    } else {
      $('cr-av').textContent = c[0];
      $('cr-au').textContent = shortUnit(op.u);
      $('cr-as').textContent = middleLine(op, null);
      var cue = mine(op);
      $('cr-me').innerHTML = (cue == null ? '<button type="button" class="cr-cue" data-pick="1">Pick your state</button> to see its own survey first.' : esc(cue)) + links;
    }
    var old = $('cr-answer').querySelector('.crb-l');
    var nb = document.createElement('div'); nb.innerHTML = bar(op, 'crb crb-l', st);
    if (old && nb.firstChild) old.parentNode.replaceChild(nb.firstChild, old);
    var dl = diy(k, op), dx = $('cr-diy');
    if (dx) { dx.textContent = dl.join(' '); dx.hidden = !dl.length; }
    $('cr-cost').innerHTML = costLine(op, k);
    dieselDraw();
    all('.cr-chip').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-crk') === k ? 'true' : 'false'); });
  }

  /* ---- a job's detail: every state's number ---- */
  function detail(k) {
    var op = S.b.ops[k], b = S.b, me = sv(S.st), nb = me && b.states[me] && b.states[me].neighbors ? b.states[me].neighbors : S.st ? (b.borders[S.st] || []) : [];
    var order = Object.keys(op.by).sort(function (x, y) {
      var w = function (s) { return s === me ? 0 : nb.indexOf(s) >= 0 ? 1 : 2; };
      return w(x) - w(y) || op.by[y][0] - op.by[x][0];
    });
    var marks = {};
    var row = function (s, v, cls, note, u) {
      var uu = u || op.u, tag = SPTAG[b.states[s].spread], basis = basisOf(op, s, v[4]);
      if (tag && v[1] != null) marks[b.states[s].spread] = 1;
      var rg = v[1] != null ? money(v[1], uu) + ' to ' + money(v[2], uu) + (tag ? ' <small>' + tag + '</small>' : '') : 'no range printed';
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + esc(stName(s)) + ' <small>' + yl(s) + (s === me ? ', your state' : nb.indexOf(s) >= 0 ? ', next door' : '') + '</small>' +
        '<span class="w">' + esc(v[4]) + (basis ? ' <em>' + esc(basis) + '</em>' : '') + (note ? ' <em>' + esc(note) + '</em>' : '') + '</span></th>' +
        '<td>' + money(v[0], uu) + (u ? ' <small>' + esc(unitLabel(u)) + '</small>' : '') + '<span class="rgm">' + rg + '</span></td>' +
        '<td class="rg">' + rg + '</td><td>' + (v[3] == null ? '<span class="na">not printed</span>' : v[3]) + '</td></tr>';
    };
    var rows = order.map(function (s) { return row(s, op.by[s], s === me ? 'me' : ''); });
    if (op.old) Object.keys(op.old).forEach(function (s) { rows.push(row(s, op.old[s], 'old' + (s === me ? ' me' : ''), 'Too old for the middle.')); });
    if (op.other) Object.keys(op.other).forEach(function (s) { rows.push(row(s, op.other[s], 'old' + (s === me ? ' me' : ''), 'A different unit, not in the middle.', op.other[s][5])); });
    if (op.apart) Object.keys(op.apart).forEach(function (s) { rows.push(row(s, op.apart[s], 'old' + (s === me ? ' me' : ''), 'Not in the middle: ' + op.apart[s][5] + '.')); });
    var used = order.concat(Object.keys(op.old || {}), Object.keys(op.other || {}), Object.keys(op.apart || {}));
    var spreads = {};
    used.forEach(function (s) { var sp = b.states[s].spread; if (sp !== 'minmax') (spreads[sp] = spreads[sp] || []).push(stName(s)); });
    var sp = Object.keys(spreads).map(function (x) { return spreads[x].join(' and ') + ': ' + SPREAD[x]; }).join('; ');
    var none = me && b.states[me] && !used.some(function (s) { return s === me; }) ? '<p class="fine">' + esc(stName(me)) + '\'s survey does not price this job the same way. Its own lines are under each category.</p>' : '';
    var dl = diy(k, op).map(function (x) { return '<p class="crd-diy">' + esc(x) + '</p>'; }).join('');
    var nobody = me && !nb.some(function (s) { return used.indexOf(s) >= 0; }) && b.states[me] ? '<p class="fine">No bordering state has a survey on this page yet that prices this job.</p>' : '';
    var inSheet = S.sheet.indexOf(k) >= 0;
    var mk = Object.keys(marks).map(function (x) { return SPTAG[x] + ': ' + SPREAD[x]; });
    var cap = 'Each state survey\'s average, ' + esc(unitLabel(op.u)) + '. Range: the lowest and highest answer' + (mk.length ? ', except where marked (' + esc(mk.join('; ')) + ')' : '') + '.';
    return '<div class="cr-tw"><table class="cr-t crd-t"><caption>' + cap + '</caption>' +
      '<thead><tr><th scope="col">State and the survey\'s words</th><th scope="col">Average</th><th scope="col" class="rg">Range</th><th scope="col">Answers</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table></div>' + none + nobody + dl +
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
    if (open) d.innerHTML = S.b ? detail(k) : '<p class="fine">' + (S.failed ? 'Not loaded. Each state\'s page still has its whole survey.' : 'Loading the rates...') + '</p>';
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
      dots.forEach(function (d, i) { d.classList.toggle('me', sts[i] === sv(S.st)); });
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
        '<td class="av">' + money(r.a, r.u) + ' <small>' + esc(unitLabel(r.u)) + '</small>' + (r.md != null ? '<span class="mdn">median ' + money(r.md, r.u) + '</span>' : r.mc != null ? '<span class="mdn">most common ' + money(r.mc, r.u) + '</span>' : '') +
        '<span class="rgm">' + (r.lo == null ? '' : 'range ' + rg) + '</span></td><td class="rg">' + rg + '</td><td>' + (r.n == null ? '<span class="na">not printed</span>' : r.n) + '</td></tr>';
    }).join('');
  }
  function stateLines(box, open) {
    var c = box.getAttribute('data-cat'), st = sv(S.st), s = st && S.b.states[st], st0 = S.st;
    var name = S.b.cats.filter(function (x) { return x[0] === c; })[0][1];
    if (!s) { box.innerHTML = st ? '<p class="fine">No ' + esc(stName(st)) + ' survey here, so there are no state lines to add.</p>' : ''; return; }
    var head = function (n) {
      return '<button type="button" class="crc-sb" aria-expanded="' + (open ? 'true' : 'false') + '">' + (n == null ? 'Every ' + esc(name) + ' line in ' : 'All ' + n + ' ' + esc(name) + ' line' + (n === 1 ? '' : 's') + ' in ') + esc(s.name) + '\'s ' + svy(st) + '</button>';
    };
    var n = s.by_cat ? s.by_cat[c] : null;
    if (n === 0) { box.innerHTML = '<p class="fine">' + esc(s.name) + '\'s survey has no ' + esc(name.toLowerCase()) + ' lines.</p>'; return; }
    if (!open) { box.innerHTML = head(n); return; }
    stateDoc(st, function (d) {
      if (!d || S.st !== st0) return;
      var rows = d.rows.filter(function (r) { return r.c === c; });
      var shown = S.q ? rows.filter(function (r) { return matches(S.q, r.s + ' ' + r.o + ' ' + r.u); }) : rows;
      box.innerHTML = head(rows.length) + (shown.length ?
        '<div class="cr-tw"><table class="cr-t cr-full"><caption>' + esc(d.name) + ', ' + (d.rate_year ? d.rate_year + ' rates' : d.survey_year) + ', as the survey printed it: average' + (d.rows.some(function (r) { return r.md != null; }) ? ', median' : '') + ' and ' + esc(d.spread_label) + '.' + (d.counts === false ? ' This survey does not print how many answered each job.' : ' Answers = how many reported that job.') + '</caption>' +
        '<thead><tr><th scope="col">Job</th><th scope="col">Average</th><th scope="col" class="rg">Range</th><th scope="col">Answers</th></tr></thead><tbody>' + lineRows(d, shown) + '</tbody></table></div>' +
        (d.page === false ? '<p class="fine">' + esc(d.range_note) + '</p>' : '<p class="fine"><a href="/custom-rates/' + esc(d.slug) + '">' + esc(d.name) + '\'s whole survey on one page</a></p>')
        : '<p class="fine">No ' + esc(d.name) + ' job matches "' + esc(S.q) + '" in this category.</p>');
    });
  }
  function allStateLines() { all('.crc-st').forEach(function (box) { stateLines(box, box.getAttribute('data-open') === '1'); }); }

  /* ---- search ---- */
  function search() {
    var q = S.q, shown = 0, first = '', st = sv(S.st), stn = st && S.b.states[st] ? S.b.states[st].name : '', hit = {};
    S.b.cats.forEach(function (c) {
      var sec = $(c[0]); if (!sec) return;
      var any = 0;
      c[2].forEach(function (k) {
        var li = $(k), h = matches(q, opText(k));
        li.hidden = !h;
        if (h) { any++; shown++; if (!first) first = k; }
      });
      hit[c[0]] = any;
      var box = sec.querySelector('.crc-st');
      if (q && stn) { box.setAttribute('data-open', '1'); stateLines(box, true); }
      /* a category with no job across states waits for the reader's own lines before it hides */
      sec.classList.toggle('nohit', !!q && !any);
      if (q) openCat(sec, true);
    });
    if (q && first) hero(first);
    var jobs = shown ? shown + ' job' + (shown === 1 ? '' : 's') + ' across states match "' + q + '".' : 'No job across states matches "' + q + '".';
    var tryw = ' Try one word, like combine, plant, spray, haul or bale.';
    if (!q) { $('cr-count').textContent = ''; return; }
    if (!stn) { $('cr-count').textContent = jobs + (shown ? '' : tryw); return; }
    $('cr-count').textContent = jobs + ' Looking in ' + stn + '\'s own lines.';
    stateDoc(st, function (d) {
      if (S.q !== q || sv(S.st) !== st) return;
      if (!d) { $('cr-count').textContent = jobs + ' ' + stn + '\'s own lines did not load.'; return; }
      var where = [], m = 0;
      S.b.cats.forEach(function (c) {
        var n = d.rows.filter(function (r) { return r.c === c[0] && matches(q, r.s + ' ' + r.o + ' ' + r.u); }).length;
        var sec = $(c[0]); if (!sec) return;
        /* the count never points at a hidden row: a category shows when it holds a match of either kind */
        sec.classList.toggle('nohit', !hit[c[0]] && !n);
        if (n) { m += n; where.push(c[1]); }
      });
      $('cr-count').textContent = jobs + (m ? ' ' + m + ' of ' + stn + '\'s own line' + (m === 1 ? '' : 's') + ' match, under ' + where.join(', ') + '.' :
        ' None of ' + stn + '\'s own lines match' + (shown ? '.' : ' either.' + tryw));
    });
  }
  /* phone: the hero sits above the search box, so a search that changed it is easy to miss. When typing settles, or on Enter,
     bring the answer into view if it is scrolled off (Nov 13, audit 3) */
  var settleT = null;
  function showHero(q) {
    if (!q || !window.matchMedia || !window.matchMedia('(max-width: 699px)').matches) return;
    var a = $('answer'); if (!a) return;
    var r = a.getBoundingClientRect();
    if (r.top >= 0) return;
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    a.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  }
  function settle(q) { clearTimeout(settleT); settleT = setTimeout(function () { if (S.q === q) showHero(q); }, 900); }
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
    /* Nov 4, 2026: the one saved-place reader (components/saved-place.js), so a ZIP typed on /cash-bids counts here too */
    var loc = null;
    try { loc = window.AgSavedPlace ? window.AgSavedPlace.read() : JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) {}
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
    noticeDraw();
    quoteDraw();
    $('cr-sheet-state').disabled = !(S.st && S.b.states[sv(S.st)]);
    if (S.q) search();
  }

  /* ---- my sheet: picked rates to print or share ---- */
  function url(extra) {
    try {
      var p = new URLSearchParams(location.search);
      ['st', 'j', 'k', 'qj'].forEach(function (x) { p.delete(x); });
      if (S.st) p.set('st', S.st);
      if (S.sheet.length) p.set('j', S.sheet.join('.'));
      if (S.k !== 'combine-corn') p.set('k', S.k);
      if (S.quote.length) p.set('qj', quoteStr());
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
    var b = S.b, st = S.st && b.states[sv(S.st)] ? sv(S.st) : '';
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
    var link = 'https://agsist.com/custom-rates' + (st || keys ? '?' + [st ? 'st=' + S.st : '', keys ? 'j=' + keys.join('.') : ''].filter(Boolean).join('&') : '');
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

  /* ---- quote my job: several jobs, the reader's numbers times the survey averages (Nov 3) ---- */
  var QJKEY = 'agsist-cr-quote';
  /* the rate a quote line uses: the reader's state's own survey average when it prices the job the
     same way, else the middle across the states, else the one survey that prices it */
  function quoteRate(op) {
    var me = stateVal(op), st = sv(S.st);
    if (me && me[2] !== 'other') {
      var sp = S.b.states[st].spread;
      /* an old survey or a line kept out of the middle says so; hauling says how far the survey's rate carries */
      var why = me[2] === 'old' ? ' (too old for the middle)' : me[2] === 'apart' ? ' (not in the middle: ' + me[0][5] + ')' : '';
      return { v: me[0][0], lo: me[0][1], hi: me[0][2], who: stName(st) + '\'s ' + svy(st) + ' average' + why, tag: SPTAG[sp] || '', basis: op.basis && op.basis[st] || '' };
    }
    if (op.md != null) return { v: op.md, lo: op.lo, hi: op.hi, who: 'the middle of ' + op.n + ' state surveys', tag: 'across the states' };
    if (op.n === 1) { var s1 = Object.keys(op.by)[0]; var v1 = op.by[s1]; return { v: v1[0], lo: v1[1], hi: v1[2], who: stName(s1) + '\'s survey average', tag: SPTAG[S.b.states[s1].spread] || '' }; }
    if (op.n === 2) return { v: null, lo: op.lo, hi: op.hi, who: '2 surveys, too few for a middle', tag: 'across the states' };
    return null;
  }
  function qtyOf(op, q) { return op.u === 'point per bushel' ? q * PTS : q; }
  function quoteLines() {
    return S.quote.map(function (j) {
      var op = S.b.ops[j.k], r = op && quoteRate(op);
      if (!op || !r) return null;
      var n = qtyOf(op, j.q), at = function (v) { return v == null ? null : shown(v, op.u) * n; };
      return { k: j.k, op: op, q: j.q, r: r, total: at(r.v), lo: at(r.lo), hi: at(r.hi) };
    }).filter(Boolean);
  }
  /* totals: the sum at the averages, and the low-high sum only over lines whose survey printed a range */
  function quoteTotals(lines) {
    var t = { sum: 0, priced: 0, lo: 0, hi: 0, ranged: 0, n: lines.length };
    lines.forEach(function (l) {
      if (l.total != null) { t.sum += l.total; t.priced++; }
      if (l.lo != null && l.hi != null) { t.lo += l.lo; t.hi += l.hi; t.ranged++; }
    });
    return t;
  }
  function quoteSave() {
    lsSet(QJKEY, quoteStr());
    url();
  }
  /* the quote in a link: job~amount, jobs joined by '_' (a '.' is a decimal point, so 12.5 acres
     survives). Links shared before Nov 4 joined jobs with '.'; the same reading takes them, since a
     job key starts with a letter and an amount never does. */
  function quoteStr() { return S.quote.map(function (j) { return j.k + '~' + j.q; }).join('_'); }
  function quoteParse(s) {
    var out = [], re = /([a-z][a-z0-9-]*)~(\d+(?:\.\d+)?)/g, m;
    while ((m = re.exec(String(s || ''))) && out.length < 20) {
      var q = parseFloat(m[2]);
      if (S.b.ops[m[1]] && isFinite(q) && q >= 0 && !out.some(function (j) { return j.k === m[1]; })) out.push({ k: m[1], q: q });
    }
    return out;
  }
  function quoteDraw() {
    var box = $('cr-quote');
    if (!box) return;
    var lines = quoteLines();
    if (!lines.length) {
      box.innerHTML = '<p class="fine">No jobs yet. Pick a job above and tap Add this job; put in your acres, bushels or miles.</p>';
      $('cr-quote-print').disabled = true;
      return;
    }
    var t = quoteTotals(lines);
    box.innerHTML = '<ul class="crq-l">' + lines.map(function (l, i) {
      var u = QTY[l.op.u] ? QTY[l.op.u][1] : ULAB[l.op.u] || l.op.u;
      return '<li class="crq-r"><span class="crq-n">' + esc(l.op.label) + ' <small>' + esc(unitLabel(l.op.u)) + '</small></span>' +
        '<label class="cr-qty">' + '<input type="number" inputmode="decimal" min="0" step="any" data-qi="' + i + '" value="' + l.q + '" aria-label="How many ' + esc(u) + ' for ' + esc(l.op.label) + '"> ' + esc(u) + '</label>' +
        '<span class="crq-v">' + (l.total != null ? '<b>' + dollars(l.total) + '</b> at ' + money(l.r.v, l.op.u) + ' ' + esc(shortUnit(l.op.u)) + (l.r.basis ? ' (' + esc(l.r.basis) + ')' : '') + ', ' + esc(l.r.who) : esc(l.r.who)) +
        (l.lo != null ? '<small>' + dollars(l.lo) + ' to ' + dollars(l.hi) + (l.r.tag ? ' (' + esc(l.r.tag) + ')' : '') + '</small>' : '<small>no range printed</small>') + '</span>' +
        '<button type="button" class="cr-btn crq-x" data-qx="' + i + '" aria-label="Take ' + esc(l.op.label) + ' off the quote">Remove</button></li>';
    }).join('') + '</ul>' +
      '<p class="crq-t"><b>' + dollars(t.sum) + '</b> at the survey averages' + (t.priced < t.n ? ' (' + t.priced + ' of ' + t.n + ' jobs have an average to use)' : '') + '.' +
      (t.ranged ? ' If each job ran from the low to the high end of its range: ' + dollars(t.lo) + ' to ' + dollars(t.hi) + (t.ranged < t.n ? ', for the ' + t.ranged + ' of ' + t.n + ' jobs whose survey printed a range' : '') + '.' : '') + '</p>' +
      '<p class="fine">Survey average x your numbers. Not a price from anyone; your local custom operator may charge more or less.</p>';
    $('cr-quote-print').disabled = false;
  }
  function quoteSpec() {
    var lines = quoteLines(), t = quoteTotals(lines), st = sv(S.st);
    var rows = lines.map(function (l) {
      var u = QTY[l.op.u] ? QTY[l.op.u][1] : unitLabel(l.op.u);
      return [l.op.label, l.q.toLocaleString('en-US') + ' ' + u, l.r.v != null ? money(l.r.v, l.op.u) + ' ' + shortUnit(l.op.u) + (l.r.basis ? ' (' + l.r.basis + ')' : '') + ', ' + l.r.who : l.r.who,
        l.total != null ? dollars(l.total) : '', l.lo != null ? dollars(l.lo) + ' to ' + dollars(l.hi) : 'no range printed'];
    });
    rows.push(['Total', '', '', dollars(t.sum), t.ranged ? dollars(t.lo) + ' to ' + dollars(t.hi) + (t.ranged < t.n ? ' (' + t.ranged + ' of ' + t.n + ' jobs)' : '') : '']);
    var used = {};
    lines.forEach(function (l) { if (st && S.b.states[st] && l.r.who.indexOf(stName(st)) === 0) used[st] = 1; else Object.keys(l.op.by).forEach(function (s) { used[s] = 1; }); });
    return {
      kicker: 'Custom farm rates', title: 'My job, at the survey averages',
      sub: st && S.b.states[st] ? stName(st) + '\'s ' + svy(st) + ' where it prices the job, else the middle across the state surveys' : 'The middle across the state surveys',
      intro: 'Survey average x your numbers. Not a price from anyone; your local custom operator may charge more or less.',
      sections: [{ h: 'Jobs', table: { head: ['Job', 'How much', 'Rate used', 'At the average', 'Range'], rows: rows } }],
      sources: Object.keys(used).sort().map(function (s) { return { name: S.b.states[s].survey + ', ' + S.b.states[s].publisher, date: svy(s) }; }),
      url: 'https://agsist.com/custom-rates?' + [S.st ? 'st=' + S.st : '', 'qj=' + quoteStr()].filter(Boolean).join('&'),
      page: 'Custom rates quote'
    };
  }
  /* a rate sheet for the reader's state and up to three neighbors, a blank column for their own price */
  function stateSheetSpec() {
    var b = S.b, st = sv(S.st);
    if (!st || !b.states[st]) return null;
    var nb = (b.states[st].neighbors || []).slice(0, 3), cols = [st].concat(nb);
    var cell = function (op, s) {
      var v = op.by[s] || (op.old && op.old[s]) || (op.apart && op.apart[s]);
      return v ? money(v[0], op.u) : '';
    };
    var sections = b.cats.filter(function (c) { return c[2].length; }).map(function (c) {
      var rows = c[2].filter(function (k) { return cols.some(function (s) { return cell(b.ops[k], s); }); }).map(function (k) {
        var op = b.ops[k];
        return [op.label + ', ' + unitLabel(op.u)].concat(cols.map(function (s) { return cell(op, s); }), [op.md != null ? money(op.md, op.u) : '', '']);
      });
      return rows.length ? { h: c[1], table: { head: ['Job'].concat(cols.map(function (s) { return b.states[s].name + ' ' + yl(s); }), ['Middle', 'My price']), rows: rows } } : null;
    }).filter(Boolean);
    return {
      kicker: 'Custom farm rates', title: b.states[st].name + ' custom rate sheet',
      sub: b.states[st].name + '\'s ' + svy(st) + (nb.length ? ' beside ' + nb.map(function (s) { return b.states[s].name; }).join(', ') : '') + ', with a column for your own price',
      intro: 'Survey averages as each survey printed them; the middle is across ' + b.rule.oldest_in_middle + ' rates or newer. Rates are survey averages; your local custom operator may charge more or less.',
      sections: sections,
      sources: cols.map(function (s) { return { name: b.states[s].survey + ', ' + b.states[s].publisher, date: svy(s) }; }),
      url: 'https://agsist.com/custom-rates?st=' + S.st, page: b.states[st].name + ' custom rate sheet'
    };
  }
  /* ---- diesel: the fuel price the reader's survey says it figured, beside USDA's farm diesel today.
     A survey number is never adjusted for fuel; this only says what changed since. ---- */
  var PC = null, PCL = null;
  function prodCosts(cb) {
    if (PC) return cb(PC);
    if (PCL) return PCL.push(cb);
    PCL = [cb];
    fetch('/data/production-costs.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { PC = d; }, function () { PC = { failed: true }; })
      .then(function () { var q = PCL; PCL = null; q.forEach(function (f) { f(PC); }); });
  }
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) { var p = String(iso).split('-'); return MON3[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0]; }
  /* USDA's farm diesel for a state: the report that names the state, or null */
  function usdaDiesel(pc, st) {
    if (!pc || !pc.reports) return null;
    var ks = Object.keys(pc.reports);
    for (var i = 0; i < ks.length; i++) {
      var r = pc.reports[ks[i]];
      if ((r.states || []).indexOf(st) < 0) continue;
      var it = (r.items || []).filter(function (x) { return x.key === 'diesel' && x.avg != null; })[0];
      if (it) return { avg: it.avg, freight: it.freight, title: r.title, date: r.published };
    }
    return null;
  }
  function dieselDraw() {
    var x = $('cr-diesel'), st = S.st;
    if (!x) return;
    if (!st || !S.b.diesel || !S.b.diesel[st]) { x.hidden = true; x.textContent = ''; return; }
    prodCosts(function (pc) { if (S.st !== st) return; x.textContent = dieselLine(st, pc); x.hidden = false; });
  }
  function dieselLine(st, pc) {
    var dz = S.b.diesel && S.b.diesel[st];
    if (!dz) return '';
    var t = 'Diesel: ' + dz.who + ' figured ' + dz.price + ' (' + dz.when + ').';
    if (!pc || pc.failed) return t + ' USDA\'s farm diesel price did not load.';
    var u = usdaDiesel(pc, st);
    if (!u) return t + ' No USDA farm diesel report covers ' + stName(st) + ', so there is no current price beside it.';
    return t + ' USDA\'s dealer survey had farm diesel at ' + money(u.avg, 'gallon') + ' a gallon' + (/deliver/i.test(u.freight || '') ? ' delivered' : '') +
      ' (USDA AMS ' + String(u.title).replace(/ *\([^)]*\)/g, '') + ', ' + day(u.date) + '). The survey rates are shown as printed, never adjusted for fuel.';
  }
  /* ---- "tell me when my state's new survey is out": one email, topic customrates:<st> on the
     subscriptions worker's /notice; scripts/send_custom_rates_notice.py mails it once ---- */
  var NOTICE_EP = 'https://agsist-api.dnilgis.workers.dev/notice';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function noticePost(body) {
    var A = window.AgsistSignup;
    if (A && A.notice) return A.notice(body);
    return fetch(NOTICE_EP, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email: body.email, source: body.source, topic: body.topic, daily: false }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: !!(r.ok && d && d.ok === true), status: r.status, data: d }; }); },
        function () { return { ok: false, status: 0, data: null }; });
  }
  function noticeDraw() {
    var box = $('cr-notice');
    if (!box) return;
    var st = S.st;
    if (!st) { box.hidden = true; box.innerHTML = ''; return; }
    var s = S.b.states[sv(st)], name = stName(st);
    var what = s ? name + '\'s next custom rate survey' : (/^[AEIO]/.test(name) ? 'an ' : 'a ') + name + ' custom rate survey';
    box.hidden = false;
    box.innerHTML = '<p class="crt-h"><b>Email me when ' + esc(what) + ' is out</b></p>' +
      '<p class="fine">One email, when it is on this page' + (s ? ' (now: the ' + esc(svy(sv(st))) + ')' : '') + '. Nothing else.</p>' +
      '<form class="crt-f" novalidate><label class="crt-l">Email<input class="crt-in" type="email" name="email" autocomplete="email" inputmode="email" placeholder="your@email.com" required></label>' +
      '<button class="cr-btn go" type="submit">Email me once</button><p class="crt-m" role="status" aria-live="polite"></p></form>';
    var form = box.querySelector('form'), em = form.querySelector('input'), btn = form.querySelector('button'), msg = form.querySelector('.crt-m');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = String(em.value || '').trim();
      if (!EMAIL_RE.test(email)) { msg.textContent = 'Check the email address.'; em.setAttribute('aria-invalid', 'true'); em.focus(); return; }
      btn.disabled = true; btn.textContent = 'Sending...'; msg.textContent = '';
      var topic = 'customrates:' + st.toLowerCase();
      noticePost({ email: email, source: 'page:custom-rates', topic: topic, daily: false, askId: 'customrates' }).then(function (res) {
        if (!res || !res.ok) {
          btn.disabled = false; btn.textContent = 'Email me once';
          var A = window.AgsistSignup;
          msg.textContent = A && A.errText ? A.errText(res) : 'That did not go through. Nothing was saved. Try again, or email sig@agsist.com and we will add you by hand.';
          return;
        }
        box.innerHTML = '<p class="crt-ok" tabindex="-1">Done. One email when ' + esc(what) + ' is on this page.</p>';
        var ok = box.querySelector('.crt-ok'); if (ok && ok.focus) ok.focus();
      });
    });
  }

  /* ---- wiring ---- */
  var OLD = { 'cr-app': 'answer', 'cr-card': 'answer', 'cr-body': 'answer', 'cr-cmp': 'answer', 'cr-st': 'answer', 'cr-q': 'answer' };
  function goHash() {
    var h = decodeURIComponent((location.hash || '').slice(1));
    if (!h) return;
    if (OLD[h]) { var a = $(OLD[h]); if (a) a.scrollIntoView(); return; }
    if (S.b.ops[h]) { var li = $(h); var sec = li.closest('.crc'); openCat(sec, true); toggle(li, true); hero(h); li.scrollIntoView(); }
    else if ($(h) && $(h).classList.contains('crc')) openCat($(h), true);
  }
  /* the pickers wait for the rates: dead controls never look live (Nov 3 panel) */
  var CONTROLS = '#cr-q, #cr-st, .cr-chip, #cr-print, #cr-quote-add';
  function controls(on) { all(CONTROLS).forEach(function (el) { el.disabled = !on; }); }
  function boot() {
    if (!$('cr-cats')) return;
    var narrow = window.matchMedia && matchMedia('(max-width: 699px)').matches;
    all('.crc').forEach(function (sec) {
      sec.querySelector('.crc-t').addEventListener('click', function () { openCat(sec, sec.classList.contains('shut')); });
      if (narrow) openCat(sec, false);
    });
    controls(false);
    status('Loading the rates...');
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('.cro-b, [data-sheet], [data-show], [data-open], [data-pick], .crc-sb');
      if (!el) return;
      if (el.classList.contains('cro-b')) return toggle(el.parentNode);
      if (!S.b) return;
      if (el.hasAttribute('data-pick')) { var pk = $('cr-st'); if (pk) { pk.scrollIntoView({ block: 'center' }); pk.focus(); } return; }
      if (el.hasAttribute('data-sheet')) return sheetToggle(el.getAttribute('data-sheet'));
      if (el.hasAttribute('data-show')) { hero(el.getAttribute('data-show')); url(); $('answer').scrollIntoView({ behavior: 'smooth' }); return; }
      if (el.hasAttribute('data-open')) { e.preventDefault(); var li = $(el.getAttribute('data-open')); openCat(li.closest('.crc'), true); toggle(li, true); li.scrollIntoView({ behavior: 'smooth' }); return; }
      if (el.classList.contains('crc-sb')) { var box = el.parentNode, o = box.getAttribute('data-open') !== '1'; box.setAttribute('data-open', o ? '1' : '0'); stateLines(box, o); }
    });
    fetch('/data/custom-rates/blend.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (b) {
        S.b = b;
        var sel = $('cr-st'), byName = function (x, y) { return b.names[x] < b.names[y] ? -1 : b.names[x] > b.names[y] ? 1 : 0; },
          cov = Object.keys(b.names).filter(function (x) { return b.states[x]; }).sort(byName), rest = Object.keys(b.names).filter(function (x) { return !b.states[x]; }).sort(byName);
        sel.innerHTML = '<option value="">Pick a state</option><optgroup label="States with a survey">' +
          cov.map(function (s) { var x = b.states[s]; return '<option value="' + s + '">' + esc(b.names[s]) + ' (' + (x.same_as ? 'shares ' + esc(b.states[x.same_as].name) + ', ' : '') + yl(s) + ')</option>'; }).join('') +
          '</optgroup><optgroup label="No survey here yet">' + rest.map(function (s) { return '<option value="' + s + '">' + esc(b.names[s]) + '</option>'; }).join('') + '</optgroup>';
        sel.addEventListener('change', function () { setState(sel.value); });
        $('cr-jobs').innerHTML = Object.keys(b.ops).map(function (k) { return '<option value="' + esc(b.ops[k].label) + '">'; }).join('');
        var qi = $('cr-q'), t = null;
        qi.addEventListener('input', function () {
          clearTimeout(t);
          t = setTimeout(function () {
            var v = qi.value.trim(), hit = Object.keys(b.ops).filter(function (k) { return b.ops[k].label.toLowerCase() === v.toLowerCase(); })[0];
            S.q = v;
            search();
            if (hit) hero(hit);
            settle(v);
          }, 140);
        });
        qi.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          clearTimeout(t); clearTimeout(settleT);
          var v = qi.value.trim(), hit = Object.keys(b.ops).filter(function (k) { return b.ops[k].label.toLowerCase() === v.toLowerCase(); })[0];
          S.q = v; search(); if (hit) hero(hit);
          showHero(v);
        });
        all('[data-crk]').forEach(function (btn) {
          btn.addEventListener('click', function () { qi.value = ''; S.q = ''; search(); hero(btn.getAttribute('data-crk')); url(); });
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
        S.quote = quoteParse(p.get('qj') || lsGet(QJKEY) || '');
        $('cr-quote-add').addEventListener('click', function () {
          if (!S.quote.some(function (j) { return j.k === S.k; })) {
            var u = S.b.ops[S.k].u;
            S.quote.push({ k: S.k, q: S.qty[u] != null ? S.qty[u] : QTY[u] ? QTY[u][0] : 1 });
          }
          quoteSave(); quoteDraw();
        });
        $('cr-quote').addEventListener('click', function (e) {
          var x = e.target.closest && e.target.closest('[data-qx]');
          if (!x) return;
          S.quote.splice(+x.getAttribute('data-qx'), 1); quoteSave(); quoteDraw();
        });
        $('cr-quote').addEventListener('change', function (e) {
          var i = e.target.getAttribute && e.target.getAttribute('data-qi');
          if (i == null) return;
          var v = parseFloat(e.target.value);
          S.quote[+i].q = isFinite(v) && v >= 0 ? v : 0; quoteSave(); quoteDraw();
        });
        $('cr-quote-print').addEventListener('click', function () { if (S.quote.length) needPrint(function () { window.AgPrintSheet.print(quoteSpec()); }); });
        $('cr-sheet-state').addEventListener('click', function () { var sp = stateSheetSpec(); if (sp) needPrint(function () { window.AgPrintSheet.print(sp); }); });
        var j = (p.get('j') || lsGet(SKEY) || '').split('.').filter(function (k) { return b.ops[k]; });
        S.sheet = j;
        var k = (p.get('k') || '').toLowerCase();
        if (b.ops[k]) S.k = k;
        var uq = p.get('q');
        if (uq) { qi.value = uq; S.q = uq.trim(); }
        var first = pickStart();
        S.st = first;
        controls(true);
        status('');
        sheetUi();
        setState(first, true);
        /* a saved ZIP with no state on record yet: the state comes from our own ZIP table, unless the reader picked one meanwhile */
        if (!first && window.AgSavedPlace) window.AgSavedPlace.full().then(function (pl) {
          if (!S.st && pl && pl.state && S.b.names[pl.state]) setState(pl.state, true);
        }, function () {});
        if (S.q) search();
        goHash();
        if (window.AgPrintSheet) window.AgPrintSheet.attach(function () { return S.b ? printSpec(S.sheet.length ? S.sheet.slice() : null) : null; });
      })
      .catch(function () {
        S.failed = true;
        status('The going rates did not load, so your state and the per-state numbers are not shown. The rates below are as of the last build; each state\'s page still has its whole survey.', true);
        $('cr-me').textContent = 'Not loaded.';
        var qb = $('cr-quote'); if (qb) qb.innerHTML = '<p class="fine">The quote needs the rates, which did not load. Reload to try again.</p>';
        all('.cro.open .cro-d').forEach(function (d) { d.innerHTML = '<p class="fine">Not loaded. Each state\'s page still has its whole survey.</p>'; });
      });
  }
  if (typeof window !== 'undefined') {
    window.AgCustomRates = { matches: matches, money: money, stem: stem, cells: cells, usdaDiesel: usdaDiesel, quoteTotals: quoteTotals, sheet: function () { return S.b ? stateSheetSpec() : null; }, quote: function () { return S.b ? quoteSpec() : null; }, quoteList: function () { return S.quote.slice(); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
