/* custom-rates.js: the /custom-rates page (2026-10-17).
 *
 * Pick a state (the reader's saved location, agsist-wx-loc, is the default
 * when that state has a survey here), see every job its survey printed with
 * the average, the range, the unit, the year and the source, search the jobs,
 * and set the common jobs beside the bordering states that have a survey.
 *
 * Data: data/custom-rates/index.json (states, sources, the common jobs side by
 * side) and data/custom-rates/<st>.json for the chosen state only. Both are
 * built by scripts/build_custom_rates.py from the survey text. This file
 * prints what the survey printed and nothing else: no averaging across
 * states, no inflation, no filling a missing range.
 */
(function () {
  'use strict';
  var KEY = 'agsist-cr-st';
  var st = { idx: null, doc: null, code: '', q: '', seq: 0, note: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  var SMALL = { 'bushel': 1, 'point per bushel': 1, 'gross bushel': 1, 'bushel / month': 1, 'bushel / year': 1,
    'bushel / round trip': 1, 'horsepower / hour': 1, 'bale / loaded mile': 1, 'bale': 1 };
  var ULAB = { '1,000 gallon': '1,000 gallons', 'head / day': 'head a day', 'bushel / month': 'bushel a month',
    'bushel / year': 'bushel a year', 'bushel / round trip': 'bushel, round trip', 'horsepower / hour': 'horsepower-hour',
    'hour / head row': 'hour per row of head', 'hour / foot of blade': 'hour per foot of blade',
    'hour / foot of blower': 'hour per foot of blower', 'bale / loaded mile': 'bale per loaded mile',
    'point per bushel': 'bushel per point' };

  function money(v, u) {
    if (v == null) return '';
    if (v < 1 && SMALL[u]) {
      var s = v.toFixed(3).replace(/0+$/, '');
      if (s.split('.')[1].length < 2) s = v.toFixed(2);
      return '$' + s;
    }
    if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
    return '$' + v.toFixed(2);
  }
  function unitLabel(u) { return 'per ' + (ULAB[u] || u); }
  function rangeText(lo, hi, u) { return lo == null ? 'not printed' : money(lo, u) + ' to ' + money(hi, u); }

  /* ---- search ---- */
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
    rip: ['rip', 'subsoil'], subsoil: ['subsoil', 'rip'], cultivat: ['cultivat'], dozer: ['doz', 'bulldoz'], doz: ['doz', 'bulldoz']
  };
  function stem(w) {
    w = w.toLowerCase();
    if (w.length > 4) w = w.replace(/(ings|ing|ers|es|s)$/, '');
    if (w.length > 5) w = w.replace(/(ed|er|e)$/, '');
    return w;
  }
  function words(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); }
  function rowText(r, idx) { return (r.s + ' ' + r.o + ' ' + r.u + ' ' + (r.k && idx.keys[r.k] ? idx.keys[r.k] : '')).toLowerCase(); }
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

  /* ---- state choice ---- */
  function covered(code) { return !!(st.idx && st.idx.states.some(function (s) { return s.st === code; })); }
  function info(code) { var a = st.idx.states.filter(function (s) { return s.st === code; }); return a[0] || null; }
  function pickStart() {
    var u = (new URLSearchParams(location.search).get('st') || '').toUpperCase();
    if (covered(u)) return { code: u };
    var saved = lsGet(KEY);
    if (saved && covered(saved)) return { code: saved };
    var loc = null;
    try { loc = JSON.parse(lsGet('agsist-wx-loc') || 'null'); } catch (e) {}
    var home = loc && /^[A-Z]{2}$/.test(loc.state || '') ? loc.state : '';
    if (home && covered(home)) return { code: home, why: 'your saved location' };
    if (home) {
      var nb = (st.idx.borders[home] || []).filter(covered);
      var name = st.idx.names[home] || home, nc = st.idx.not_covered[home];
      var msg = 'No ' + name + ' survey here' + (nc ? ': ' + nc : '.') + (nb.length ? ' Showing ' + info(nb[0]).name + ', next door.' : ' Showing Iowa.');
      return { code: nb[0] || 'IA', note: msg };
    }
    return { code: 'IA' };
  }

  function setState(code, why) {
    st.code = code;
    lsSet(KEY, code);
    var sel = $('cr-st'); if (sel) sel.value = code;
    try {
      var p = new URLSearchParams(location.search); p.set('st', code);
      history.replaceState(null, '', location.pathname + '?' + p.toString() + location.hash);
    } catch (e) {}
    load(code, why);
  }

  function load(code, why) {
    var my = ++st.seq, s = info(code);
    $('cr-status').className = 'cr-status';
    $('cr-status').textContent = 'Loading the ' + s.name + ' survey...';
    fetch('/data/custom-rates/' + code.toLowerCase() + '.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        if (my !== st.seq) return;
        st.doc = d;
        $('cr-status').textContent = st.note || (why ? 'Picked from ' + why + '.' : '');
        st.note = '';
        render();
      })
      .catch(function () {
        if (my !== st.seq) return;
        $('cr-status').className = 'cr-status err';
        $('cr-status').textContent = 'The ' + s.name + ' table did not load. Check the connection and pick the state again, or open the survey itself: ' + s.url;
      });
  }

  /* ---- render ---- */
  function render() {
    var d = st.doc, idx = st.idx; if (!d) return;
    var src = d.sources.map(function (x, i) { return '<a href="' + esc(x.url) + '" rel="nofollow">' + (i ? 'second part' : 'the survey') + '</a>'; }).join(' and ');
    $('cr-card').innerHTML =
      '<p><b>' + esc(d.name) + ', ' + d.survey_year + ' survey.</b> ' + esc(d.survey) + ', ' + esc(d.publisher) + '. Read ' + src + '.</p>' +
      '<p class="fine">' + esc(d.collected.replace(/\.$/, '')) + '. ' + esc(d.includes) + '</p>' +
      '<p class="fine">' + esc(d.range_note) + (d.withheld ? ' ' + esc(d.withheld) : '') + '</p>' +
      '<p class="fine">Rates are survey averages; your local custom operator may charge more or less. <a href="/custom-rates/' + esc(d.slug) + '">' + esc(d.name) + ' page</a></p>';
    var q = st.q, shown = 0, last = '', html = [];
    d.rows.forEach(function (r) {
      if (!matches(q, rowText(r, idx))) return;
      if (r.s !== last) { html.push('<tr class="sec"><th colspan="4" scope="colgroup">' + esc(r.s) + '</th></tr>'); last = r.s; }
      var rg = rangeText(r.lo, r.hi, r.u);
      html.push('<tr><th scope="row">' + esc(r.o) + (r.p === 'cents' ? ' <small>(printed in cents)</small>' : '') + '</th>' +
        '<td class="av">' + money(r.a, r.u) + ' <small>' + esc(unitLabel(r.u)) + '</small><span class="rgm">' + (r.lo == null ? '' : 'range ' + rg) + '</span></td>' +
        '<td class="rg">' + rg + '</td><td>' + r.n + '</td></tr>');
      shown++;
    });
    $('cr-cap').textContent = d.name + ', ' + d.survey_year + ': average and ' + d.spread_label + ' for each job. Answers = how many reported that job.';
    $('cr-body').innerHTML = html.join('') || '<tr><td colspan="4" class="na" style="text-align:left">No ' + esc(d.name) + ' job matches "' + esc(q) + '". Try one word, like combine, plant, spray, haul or bale.</td></tr>';
    $('cr-count').textContent = q ? shown + ' of ' + d.rows.length + ' jobs match "' + q + '".' : d.rows.length + ' jobs in the ' + d.survey_year + ' ' + d.name + ' survey.';
    renderCompare();
  }

  function renderCompare() {
    var d = st.doc, idx = st.idx, me = info(d.state), nb = me.neighbors.slice();
    var box = $('cr-cmp');
    if (!nb.length) {
      box.innerHTML = '<p class="fine">No bordering state has a survey on this page yet, so there is nothing next door to set beside ' + esc(d.name) + '.</p>';
      return;
    }
    var cols = [d.state].concat(nb), rows = [], items = [];
    Object.keys(idx.keys).forEach(function (k) {
      var c = idx.common[k]; if (!c || !c[d.state]) return;
      var mine = c[d.state];
      var others = nb.filter(function (x) { return c[x] && c[x][1] === mine[1]; });
      if (!others.length) return;
      if (!matches(st.q, idx.keys[k] + ' ' + mine[5])) return;
      var tds = cols.map(function (x) {
        var v = c[x];
        if (!v) return '<td><span class="na">not in survey</span></td>';
        if (v[1] !== mine[1]) return '<td><span class="na">other unit</span></td>';
        return '<td title="' + esc(v[5]) + '">' + money(v[0], v[1]) + '<small> (' + v[4] + ')</small></td>';
      });
      rows.push('<tr><th scope="row">' + esc(idx.keys[k]) + ' <small>' + esc(unitLabel(mine[1])) + '</small></th>' + tds.join('') + '</tr>');
      items.push('<li><b>' + esc(idx.keys[k]) + '</b> <small>' + esc(unitLabel(mine[1])) + '</small><span>' + cols.map(function (x) {
        var v = c[x], nm = info(x).name;
        if (!v || v[1] !== mine[1]) return '';
        return '<i' + (x === d.state ? ' class="me"' : '') + '>' + esc(nm) + ' ' + money(v[0], v[1]) + ' <small>(' + v[4] + ')</small></i>';
      }).join('') + '</span></li>');
    });
    if (!rows.length) {
      box.innerHTML = '<p class="fine">' + (st.q ? 'None of the matching jobs is in a bordering state\'s survey with the same unit.' : 'No common job with the same unit in the bordering surveys.') + '</p>';
      return;
    }
    var head = cols.map(function (x) { var s = info(x); return '<th scope="col">' + esc(s.name) + '<br><small>' + (s.yl || s.year) + '</small></th>'; }).join('');
    box.innerHTML = '<div class="cr-tw"><table class="cr-t cr-cmp"><caption>Average, with the number of answers in brackets. Each survey words its jobs its own way and was taken in a different year, so read these as close matches, not the same job. The full table above shows this state\'s wording.</caption>' +
      '<thead><tr><th scope="col">Job</th>' + head + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      '<ul class="cr-cmpl">' + items.join('') + '</ul>';
  }

  function boot() {
    var root = $('cr-app'); if (!root) return;
    fetch('/data/custom-rates/index.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (idx) {
        st.idx = idx;
        var sel = $('cr-st');
        sel.innerHTML = idx.states.map(function (s) { return '<option value="' + s.st + '">' + esc(s.name) + ' (' + s.year + ' survey)</option>'; }).join('');
        sel.addEventListener('change', function () { setState(sel.value); });
        var qi = $('cr-q'), t = null;
        qi.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { st.q = qi.value.trim(); render(); }, 120); });
        Array.prototype.forEach.call(document.querySelectorAll('[data-crq]'), function (b) {
          b.addEventListener('click', function () { qi.value = b.getAttribute('data-crq'); st.q = qi.value; render(); qi.focus(); });
        });
        var uq = new URLSearchParams(location.search).get('q');
        if (uq) { qi.value = uq; st.q = uq.trim(); }
        root.hidden = false;
        var p = pickStart();
        st.note = p.note || '';
        setState(p.code, p.why);
      })
      .catch(function () {
        $('cr-status').className = 'cr-status err';
        $('cr-status').textContent = 'The state list did not load. The state pages below still work.';
      });
  }
  if (typeof window !== 'undefined') {
    window.AgCustomRates = { matches: matches, money: money, stem: stem };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})();
