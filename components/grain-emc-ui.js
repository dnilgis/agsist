/* grain-emc-ui.js: the /grain-emc page. Math lives in grain-emc.js (AgEMC);
 * this file reads the inputs, gets the forecast and draws.
 * Forecast: Open-Meteo hourly temperature, relative humidity and weather code
 * (unix time, labeled in the farm's own time zone), fetched in the reader's
 * browser. ZIP to a point: the bids ZIP table, then Open-Meteo's geocoder.
 * Location is kept in localStorage (agsist-wx-loc, shared with /spray and
 * /urea); settings in agsist-emc. The typed-reading box needs no network. */
(function () {
  'use strict';
  var E = window.AgEMC;
  if (!E) return;
  var $ = function (id) { return document.getElementById(id); };
  var LS_LOC = 'agsist-wx-loc', LS_SET = 'agsist-emc';
  var ZIPS = 'https://dnilgis.github.io/bids/data/zips/';
  var STALE_MS = 30 * 60e3, OLD_MS = 2 * 3600e3;
  var MODES = { dry: 'Drying wet grain', cool: 'Cooling it down', hold: 'Holding dry grain' };
  var S = { mode: 'hold', grain: 'corn', targets: {}, current: null, fan: 0, grainF: null, grainDry: true, cfm: null,
            raw: null, rows: null, place: null, tz: null, fetchedAt: 0, seq: 0, sel: -1, loc: null };

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function fmt(x, d) { return E.num(x) ? (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d) : 'no number'; }
  function numIn(el) { var s = String(el.value).replace(',', '.').trim(); if (s === '') return null; var v = parseFloat(s); return isFinite(v) ? v : null; }
  function inRange(v, a, b) { return E.num(v) && v >= a && v <= b ? v : null; }
  function g() { return E.GRAINS[S.grain]; }
  function gname() { return g().name.toLowerCase(); }
  function target() { var t = S.targets[S.grain]; return E.num(t) ? t : g().target; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function emcText(e) {
    if (!e || !e.ok) return 'no number';
    var lo = fmt(e.wb, 1), hi = fmt(e.wet, 1);
    var v = lo === hi ? lo + '%' : lo + ' to ' + hi + '%';
    return (e.bound === 'over' ? 'over ' : e.bound === 'under' ? 'under ' : '') + v;
  }
  function opts(extra) {
    var o = { mode: S.mode, grain: S.grain, target: target(), current: S.current, fan: S.fan, grainF: S.grainF, grainDry: S.grainDry };
    for (var k in extra) o[k] = extra[k];
    return o;
  }

  /* ---------- time, in the farm's zone ---------- */
  function parts(ms) {
    var o = { hour: 'numeric', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' };
    if (S.tz) o.timeZone = S.tz;
    var p = {};
    try { new Intl.DateTimeFormat('en-US', o).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; }); }
    catch (e) { var d = new Date(ms); p = { hour: String(d.getHours()), weekday: d.toDateString().slice(0, 3), year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }; }
    var h = parseInt(p.hour, 10) % 24;
    return { h: h, wd: p.weekday, date: p.year + '-' + p.month + '-' + p.day };
  }
  function clock(h) { return h === 0 ? 'midnight' : h === 12 ? 'noon' : (h % 12) + (h < 12 ? ' am' : ' pm'); }
  function dayWord(ms) {
    var p = parts(ms), n = parts(Date.now());
    var tomorrow = parts(Date.now() + 864e5).date;
    if (p.date === n.date) return p.h >= 18 ? 'tonight' : 'today';
    if (p.date === tomorrow && p.h < 6 && n.h >= 12) return 'tonight';
    if (p.date === tomorrow && p.h >= 6) return 'tomorrow';
    return p.wd;
  }
  function when(ms) { var h = parts(ms).h, w = dayWord(ms); if (h === 0) return w === 'tonight' ? 'midnight' : w + ' midnight'; return w + ' ' + clock(h); }
  function hourOnly(ms) { var w = dayWord(ms); return (w === 'today' || w === 'tonight' ? '' : w + ' ') + clock(parts(ms).h); }
  function dayName(ms) { var p = parts(ms); return p.date === parts(Date.now()).date ? 'today' : p.wd; }

  /* ---------- words per mode ---------- */
  var WORD = {
    hold: { dry: 'dries', close: 'close call', wet: 'wets' },
    dry: { dry: 'dries to target', part: 'dries, not to target', wet: 'wets' },
    cool: { cool: 'cools', mild: 'cools slowly', warm: 'warms', skip: 'skip (rain or fog)' }
  };
  var HEAD = { dry: 'Fans dry it', close: 'Close call', wet: 'Fans wet it' };
  function callWord(c) { return c ? (WORD[S.mode][c] || c) : 'no answer'; }
  var SHAPE = { hold: { dry: 'up', close: 'mid', wet: 'down' }, dry: { dry: 'up', part: 'mid', wet: 'down' }, cool: { cool: 'up', mild: 'mid', warm: 'down', skip: 'skip' } };

  /* ---------- settings ---------- */
  function readSettings() {
    var s = lsGet(LS_SET) || {};
    var q = new URLSearchParams(location.search);
    var L = E.LIMITS;
    S.mode = E.has(MODES, q.get('mode')) ? q.get('mode') : (E.has(MODES, s.mode) ? s.mode : 'hold');
    S.grain = E.has(E.GRAINS, q.get('grain')) ? q.get('grain') : (E.has(E.GRAINS, s.grain) ? s.grain : 'corn');
    S.targets = {};
    if (s.targets && typeof s.targets === 'object') for (var k in E.GRAINS) { var tv = inRange(s.targets[k], L.targetMin, L.targetMax); if (tv != null) S.targets[k] = tv; }
    var tq = inRange(parseFloat(q.get('target')), L.targetMin, L.targetMax);
    if (tq != null) S.targets[S.grain] = tq;
    var fq = inRange(parseFloat(q.get('fan')), 0, L.fanMax);
    S.fan = fq != null ? fq : (inRange(s.fan, 0, L.fanMax) || 0);
    S.current = inRange(s.current, 10, 35);
    S.grainF = inRange(s.grainF, -20, 110);
    S.grainDry = s.grainDry !== false;
    S.cfm = inRange(s.cfm, 0.01, 5);
    var mt = parseFloat(q.get('t')), mr = parseFloat(q.get('rh'));
    if (isFinite(mt)) $('emc-mt').value = mt;
    if (isFinite(mr)) $('emc-mrh').value = mr;
    if (isFinite(mt) && isFinite(mr)) $('emc-manual').open = true;
  }
  function save() { lsSet(LS_SET, { mode: S.mode, grain: S.grain, targets: S.targets, fan: S.fan, current: S.current, grainF: S.grainF, grainDry: S.grainDry, cfm: S.cfm }); }
  function syncInputs() {
    var b = document.querySelectorAll('[data-grain]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', b[i].getAttribute('data-grain') === S.grain ? 'true' : 'false');
    var m = document.querySelectorAll('[data-mode]');
    for (var j = 0; j < m.length; j++) m[j].setAttribute('aria-pressed', m[j].getAttribute('data-mode') === S.mode ? 'true' : 'false');
    document.documentElement.setAttribute('data-emc-mode', S.mode);
    $('emc-target').value = fmt(target(), 1);
    $('emc-fan').value = S.fan || 0;
    $('emc-cur').value = S.current != null ? S.current : '';
    $('emc-gt').value = S.grainF != null ? S.grainF : '';
    $('emc-gdry').checked = S.grainDry;
    $('emc-cfm').value = S.cfm != null ? S.cfm : '';
    var n = document.querySelectorAll('[data-gname]');
    for (var k = 0; k < n.length; k++) n[k].textContent = gname();
  }

  /* ---------- the answer ---------- */
  function nowRow() {
    var r = S.raw;
    if (r.now && E.num(r.now.tF) && E.num(r.now.rh)) return { label: 'Forecast air now', tF: r.now.tF, rh: r.now.rh, code: r.now.code };
    for (var i = 0; i < r.hours.length; i++) {
      var h = r.hours[i];
      if (E.num(h.tF) && E.num(h.rh)) return { label: 'Forecast air at ' + when(h.t), tF: h.tF, rh: h.rh, code: h.code };
    }
    return null;
  }
  function airWords(a) {
    var s = fmt(a.tF, 0) + ' F and ' + fmt(a.rh, 0) + '% humidity';
    if (S.fan > 0 && E.num(a.fanTF)) s += ', ' + fmt(a.fanTF, 0) + ' F and ' + fmt(a.fanRh, 0) + '% after the fan';
    return s;
  }
  /* "until about 9 pm. Then wets until 9 am tomorrow." from the hour runs. */
  function tonight(rows) {
    var rs = E.runs(rows);
    if (!rs.length) return '';
    var a = rs[0], b = rs[1];
    var s = 'Now ' + callWord(a.call) + ' ';
    s += a.end === rows.length - 1 ? 'for the whole forecast.' : 'until about ' + hourOnly(rows[a.end].t + 3600e3) + '.';
    if (b) s += ' Then ' + callWord(b.call) + (b.end === rows.length - 1 ? ' to the end of the forecast.' : ' until about ' + when(rows[b.end].t + 3600e3) + '.');
    return s;
  }

  function render() {
    if (!S.raw) { renderNoLoc(); return; }
    var age = Date.now() - S.fetchedAt;
    var rows = E.hourly(opts(), S.raw.hours);
    S.rows = rows;
    var nr = nowRow();
    var now = nr ? E.assess(opts({ wx: E.wxKind(nr.code) }), nr.tF, nr.rh) : null;
    var v = $('emc-verdict'), box = $('emc-answer'), lines = [];
    var head = '', cls = 'none';
    if (S.stale) { head = 'Forecast is ' + Math.floor(age / 3600e3) + ' hours old. Refresh the page.'; }
    else if (S.mode === 'dry') {
      var wxRun = 0;
      for (var i = 0; i < rows.length && (rows[i].wx === 'rain' || rows[i].wx === 'fog' || rows[i].wx === 'snow'); i++) wxRun++;
      if (wxRun >= 3) { head = 'Fans off: steady ' + rows[0].wx + ' until about ' + hourOnly(rows[wxRun - 1].t + 3600e3); cls = 'wet'; }
      else { head = 'Keep fans running'; cls = 'dry'; }
      if (S.current == null) lines.push('<b>Type your grain\'s moisture</b> above to see which hours dry it and which wet it.');
      else if (S.current <= target()) lines.push('Your grain is already at or under your ' + fmt(target(), 1) + '% target. Switch to <b>Holding dry grain</b>.');
      else if (now) lines.push(nr.label + ': ' + airWords(now) + '. That air brings ' + gname() + ' to <b>' + emcText(now.emc) + '</b>: ' + callWord(now.call) + ' for grain at ' + fmt(S.current, 1) + '%.');
      if (S.current != null && S.current > target()) lines.push(tonight(rows));
      lines.push('<span class="note">For natural-air drying, NDSU Extension says to run fans around the clock until the drying front comes out the top of the bin, and to shut off only for steady rain, fog or snow. That advice was written for wheat; NDSU adds that running only in the driest hours overdries the bottom and stretches the drying time.</span>');
      E.dryWarnings(rows).forEach(function (w) {
        if (w.kind === 'cold') lines.push('<b>Cold:</b> the next 24 hours average ' + fmt(w.avg, 0) + ' F. NDSU says natural-air drying does little until outside air averages about 40 F.');
        if (w.kind === 'humid') lines.push('<b>Humid:</b> humidity averages ' + fmt(w.avg, 0) + '% over the forecast. NDSU (wheat) says to add a little heat when average humidity runs over 70%.');
      });
      if (S.cfm != null && S.cfm < 1) lines.push('<b>Airflow:</b> at ' + S.cfm + ' cfm per bushel the fans cool more than they dry. Aeration fans at 0.1 to 0.2 cfm per bushel do not dry grain safely; drying corn takes about 1 cfm per bushel or more.');
      var dryAvg = E.avg(rows.map(function (r) { return { x: r.emc && r.emc.ok ? r.emc.wb : null }; }), 'x');
      if (dryAvg && dryAvg.avg <= target() - 2) lines.push('<b>Overdrying:</b> this air averages ' + fmt(dryAvg.avg, 1) + '% ' + gname() + ' EMC, well under your target. The bottom of the bin will end drier than ' + fmt(target(), 1) + '%, which is weight you sell for nothing.');
    } else if (S.mode === 'cool') {
      if (S.grainF == null) { head = 'How warm is the grain?'; lines.push('Type the grain temperature (from cables or a probe) above. NDSU Extension says to cool when outside air averages 10 to 15 F under the grain.'); }
      else {
        var a24 = E.avg(rows.map(function (r) { return { x: r.fanTF }; }), 'x', 0, 24);
        if (!a24) head = 'No forecast temperatures';
        else {
          var gap = S.grainF - a24.avg;
          if (gap >= E.COOL_GAP_F) { head = 'Cool now'; cls = 'dry'; }
          else if (gap > 0) { head = 'Cools slowly'; cls = 'close'; }
          else { head = 'Too warm to cool'; cls = 'wet'; }
          lines.push('The next 24 hours average <b>' + fmt(a24.avg, 0) + ' F</b>' + (S.fan > 0 ? ' at the fan' : '') + ', ' + (gap > 0 ? fmt(gap, 0) + ' F under' : fmt(-gap, 0) + ' F over') + ' your ' + fmt(S.grainF, 0) + ' F grain. NDSU Extension says to cool when outside air averages 10 to 15 F under the grain.');
          lines.push(dayAverages(rows));
          var bw = E.bestWindow(rows, 'cool', 3);
          if (bw) lines.push(zach() + ' <b>' + when(rows[bw.start].t) + ' to ' + when(rows[bw.end].t + 3600e3) + '</b>, ' + bw.len + ' hours of air 10 F or more under the grain.' + zachNote());
          lines.push('Humidity matters little for cooling: the cooling front moves much faster than the moisture front (Iowa State). ' + (S.grainDry ? 'For grain that is already dry, skip hours of rain or fog.' : 'For warm or wet grain, keep fans running through humid air.') + ' Check the top of the bin for condensation and crusting.');
        }
      }
    } else {
      cls = now && now.call ? now.call : 'none';
      head = now && now.call ? HEAD[now.call] : 'No answer for this air';
      if (now) lines.push(nr.label + ': ' + airWords(now) + '. That air holds ' + gname() + ' at <b>' + emcText(now.emc) + '</b>' + (S.grain === 'corn' && now.emc.ok ? ' (two published fits)' : '') + '. Your target is ' + fmt(target(), 1) + '%.');
      if (now && !now.emc.ok) lines.push('No number: ' + esc(now.emc.reason) + '.');
      if (now && now.call === 'close') lines.push('<b>Close call:</b> published tables disagree about air like this. For grain that is already dry, run only if you need to cool it; this air will not move much moisture either way.');
      lines.push(tonight(rows));
      var best = E.bestWindow(rows, 'dry', 2);
      lines.push(best ? zach() + ' <b>' + when(rows[best.start].t) + ' to ' + when(rows[best.end].t + 3600e3) + '</b>, ' + best.len + ' hours of drying air, at or under ' + fmt(best.worst, 1) + '% ' + gname() + ' EMC.' + zachNote()
                      : 'No run of 2 or more drying hours in the next ' + rows.length + ' hours.');
      if (now && E.num(now.fanTF)) {
        var inv = E.rhDries(S.grain, now.fanTF, target());
        if (inv && inv.inRange) {
          var outRh = S.fan > 0 ? E.unwarmRh(now.tF, inv.rh, S.fan) : inv.rh;
          lines.push('At ' + fmt(now.tF, 0) + ' F outside, fans dry ' + gname() + ' toward your target while outside humidity stays under <b>' + Math.floor(outRh) + '%</b>' + (S.fan > 0 ? ' (with the fan\'s ' + S.fan + ' F)' : '') + '. Read your own gauge against that.');
        }
      }
      lines.push('Aeration fans at 0.1 to 0.2 cfm per bushel cool grain but do not dry it safely; drying corn takes about 1 cfm per bushel or more.');
    }
    box.className = 'emc-answer v-' + cls;
    v.textContent = head;
    $('emc-now').innerHTML = lines.filter(Boolean).map(function (l) { return /^<span class="note">/.test(l) ? '<p class="note">' + l.replace(/^<span class="note">|<\/span>$/g, '') + '</p>' : '<p>' + l + '</p>'; }).join('');
    var nAns = 0, nMiss = 0, nOut = 0;
    rows.forEach(function (r) { if (r.missing) nMiss++; else if (r.call == null) nOut++; else nAns++; });
    var counts = Object.keys(WORD[S.mode]).map(function (c) { return E.count(rows, c) + ' ' + callWord(c); }).join(', ');
    $('emc-count').textContent = 'Next ' + rows.length + ' hours: ' + counts + (nOut ? ', ' + nOut + ' with no answer' : '') + (nMiss ? ', ' + nMiss + ' with no forecast reading' : '') + '.';
    var mins = Math.round(age / 60e3);
    var tzNote = '';
    try { var mine = Intl.DateTimeFormat().resolvedOptions().timeZone; if (S.tz && mine && mine !== S.tz) tzNote = ' Times are ' + S.tz.replace(/_/g, ' ') + ' time.'; } catch (e) {}
    $('emc-asof').textContent = 'Forecast from Open-Meteo for ' + S.place + ', pulled ' + (mins < 1 ? 'just now' : mins + ' minutes ago') + '. Fan heat: ' + (S.fan > 0 ? S.fan + ' F.' : 'none.') + tzNote + flipNote(rows);
    drawStrip(rows);
    if ($('emc-table').open) drawTable(rows);
    renderShare(now, head);
    $('emc-results').hidden = false;
    $('emc-hours').hidden = false;
    $('emc-intro').hidden = true;
  }
  function zach() { return '<span style="white-space:nowrap"><button type="button" class="emc-zw" aria-expanded="false" aria-controls="emc-zwn" title="The longest run of good fan hours ahead. Named for Zach A., who asked for this tool.">Best fan window (Zach&rsquo;s window)</button>:</span>'; }
  function zachNote() { return '<span id="emc-zwn" class="emc-zwn" hidden>The longest run of good fan hours ahead. Named for Zach A., who asked for this tool.</span>'; }
  function dayAverages(rows) {
    var days = [], cur = null;
    rows.forEach(function (r) {
      var p = parts(r.t);
      if (!cur || cur.date !== p.date) { cur = { date: p.date, t: r.t, s: 0, n: 0 }; days.push(cur); }
      if (E.num(r.fanTF)) { cur.s += r.fanTF; cur.n++; }
    });
    var out = days.filter(function (d) { return d.n >= 6; }).map(function (d) {
      var a = d.s / d.n;
      return dayName(d.t) + ' ' + fmt(a, 0) + ' F' + (d.n < 24 ? ' (rest of day)' : '');
    });
    return out.length ? 'Daily averages ahead: ' + out.join(', ') + '.' : '';
  }
  /* With no fan heat entered, how many hours would change call at +3 F. */
  function flipNote(rows) {
    if (S.fan > 0 || S.mode === 'cool' || !S.raw) return '';
    var alt = E.hourly(opts({ fan: 3 }), S.raw.hours), n = 0;
    for (var i = 0; i < rows.length; i++) if (alt[i].call !== rows[i].call) n++;
    return n ? ' With 3 F of fan heat, ' + n + ' of these hours would change.' : '';
  }
  function renderNoLoc() {
    $('emc-verdict').textContent = 'Where are your bins?';
    $('emc-answer').className = 'emc-answer v-none';
  }

  /* ---------- strip ---------- */
  function drawStrip(rows) {
    var el = $('emc-strip'), n = rows.length, html = [], ticks = [], lastLabelAt = -99;
    var shapes = SHAPE[S.mode];
    for (var i = 0; i < n; i++) {
      var r = rows[i], p = parts(r.t);
      var sh = r.missing ? 'miss' : (r.call ? shapes[r.call] : 'none');
      html.push('<span class="b s-' + sh + ' c-' + (r.call || 'none') + (i === S.sel ? ' sel' : '') + '" style="left:' + (i * 100 / n) + '%;width:' + (100 / n) + '%"></span>');
      if (p.h % 6 === 0) ticks.push('<span class="tk" style="left:' + (i * 100 / n) + '%"></span>');
      if (p.h === 0 || i === 0) {
        if (i - lastLabelAt >= 6 || i === 0) {
          if (i === 0 && n > 1) { var nextMid = -1; for (var j = 1; j < Math.min(n, 6); j++) if (parts(rows[j].t).h === 0) { nextMid = j; break; } if (nextMid > 0) continue; }
          html.push('<span class="dl" style="left:' + (i * 100 / n) + '%">' + esc(p.wd) + '</span>');
          lastLabelAt = i;
        }
      }
      if (p.h === 12 || p.h === 6 || p.h === 18) html.push('<span class="hl" style="left:' + (i * 100 / n) + '%">' + (p.h === 12 ? 'noon' : p.h === 6 ? '6a' : '6p') + '</span>');
    }
    el.innerHTML = '<span class="mid"></span>' + ticks.join('') + html.join('');
    el.setAttribute('aria-label', 'Next ' + n + ' hours, one bar an hour. Use the arrow keys to read each hour.');
  }
  function tipFor(i) {
    var r = S.rows && S.rows[i];
    if (!r) return '';
    if (r.missing) return when(r.t) + ': no forecast reading.';
    var s = when(r.t) + ': ' + fmt(r.tF, 0) + ' F, ' + fmt(r.rh, 0) + '%';
    if (S.fan > 0) s += ' (' + fmt(r.fanTF, 0) + ' F, ' + fmt(r.fanRh, 0) + '% at the fan)';
    if (r.wx) s += ', ' + r.wx;
    if (S.mode !== 'cool') s += ', EMC ' + emcText(r.emc);
    s += ': ' + (r.call ? callWord(r.call) : (r.emc && !r.emc.ok ? r.emc.reason : 'no answer')) + '.';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function select(i) {
    if (!S.rows || !S.rows.length) return;
    S.sel = Math.max(0, Math.min(S.rows.length - 1, i));
    var b = $('emc-strip').querySelectorAll('.b');
    for (var k = 0; k < b.length; k++) b[k].classList.toggle('sel', k === S.sel);
    $('emc-tip').textContent = tipFor(S.sel);
  }
  function stripPointer(e) {
    if (!S.rows) return;
    var rect = $('emc-strip').getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    select(Math.floor(x / rect.width * S.rows.length));
  }
  function drawTable(rows) {
    var head = '<tr><th scope="col">Hour</th><th scope="col">Air</th>' + (S.fan > 0 ? '<th scope="col">At fan</th>' : '') + (S.mode !== 'cool' ? '<th scope="col">EMC</th>' : '') + '<th scope="col">Call</th></tr>';
    var body = rows.map(function (r) {
      if (r.missing) return '<tr><th scope="row">' + esc(when(r.t)) + '</th><td colspan="4">no forecast reading</td></tr>';
      return '<tr><th scope="row">' + esc(when(r.t)) + '</th><td>' + fmt(r.tF, 0) + ' F, ' + fmt(r.rh, 0) + '%' + (r.wx ? ', ' + r.wx : '') + '</td>' +
        (S.fan > 0 ? '<td>' + fmt(r.fanTF, 0) + ' F, ' + fmt(r.fanRh, 0) + '%</td>' : '') +
        (S.mode !== 'cool' ? '<td>' + emcText(r.emc) + '</td>' : '') + '<td>' + esc(callWord(r.call)) + '</td></tr>';
    }).join('');
    $('emc-tbl').innerHTML = '<thead>' + head + '</thead><tbody>' + body + '</tbody>';
  }

  /* ---------- typed reading ---------- */
  function renderManual() {
    var t = numIn($('emc-mt')), rh = numIn($('emc-mrh')), out = $('emc-mout');
    if (t == null || rh == null) { out.textContent = 'Type a temperature and a humidity.'; out.className = 'emc-mout'; return; }
    var plenum = $('emc-plenum').checked;
    var mode = S.mode === 'cool' ? 'hold' : S.mode;
    var a = E.assess(opts({ mode: mode, fan: plenum ? 0 : S.fan }), t, rh);
    if (!a.emc.ok) { out.className = 'emc-mout v-none'; out.textContent = 'No answer: ' + a.emc.reason + '.'; return; }
    out.className = 'emc-mout v-' + (a.call || 'none');
    var s = '';
    if (!plenum && S.fan > 0) s += 'With the fan adding ' + S.fan + ' F, that air reaches the grain at ' + fmt(a.fanTF, 0) + ' F and ' + fmt(a.fanRh, 0) + '%. ';
    s += g().name + ' in that air heads for <b>' + emcText(a.emc) + '</b>. ';
    if (mode === 'dry') s += S.current == null ? 'Type your grain\'s moisture at the top to judge drying.' : 'For grain at ' + fmt(S.current, 1) + '%: <b>' + callWord(a.call) + '</b>.';
    else s += 'Against your ' + fmt(target(), 1) + '% target: <b>' + (a.call ? HEAD[a.call] : 'no answer') + '</b>.';
    out.innerHTML = s;
  }

  /* ---------- humidity limits table ---------- */
  function renderTable() {
    var t = target(), rows = [], fan = S.fan > 0;
    for (var f = 30; f <= 90; f += 10) {
      var hold = E.rhFor(S.grain, f, t), dries = E.rhDries(S.grain, f, t);
      var cells = '<td>' + cell(hold) + '</td><td>' + cell(dries) + '</td>';
      if (fan) {
        var hf = E.rhFor(S.grain, f + S.fan, t), df = E.rhDries(S.grain, f + S.fan, t);
        cells += '<td>' + cell(df && { rh: E.unwarmRh(f, df.rh, S.fan), inRange: true }) + '</td>';
        void hf;
      }
      rows.push('<tr><th scope="row">' + f + ' F</th>' + cells + '</tr>');
    }
    $('emc-rhtab').innerHTML = rows.join('');
    $('emc-rhcap1').textContent = fmt(t, 1);
    $('emc-rhcap2').textContent = fmt(t, 1);
    $('emc-rhfan').hidden = !fan;
    if (fan) $('emc-rhfan').textContent = 'Dries, outside air with ' + S.fan + ' F fan heat';
    function cell(x) {
      if (!x || !E.num(x.rh)) return 'no number';
      if (x.rh > E.LIMITS.rhMax) return 'over ' + E.LIMITS.rhMax + '%';
      if (x.rh < E.LIMITS.rhMin) return 'under ' + E.LIMITS.rhMin + '%';
      return Math.floor(x.rh) + '%';
    }
  }

  /* ---------- cooling front ---------- */
  function renderCooling() {
    var h = E.coolingHours(S.cfm), out = $('emc-cout');
    if (S.cfm == null) { out.textContent = 'Type your airflow to see how long one cooling front takes.'; return; }
    if (h == null) { out.textContent = 'Airflow should be between 0 and 5 cfm per bushel.'; return; }
    var s = 'At ' + S.cfm + ' cfm per bushel, one cooling front takes about <b>' + Math.round(h) + ' fan hours</b> to pass through the bin.';
    if (S.rows && S.grainF != null) {
      var n = E.count(S.rows, 'cool');
      s += ' The forecast has <b>' + n + '</b> hours 10 F or more under your grain' + (n >= h ? ', enough for one front.' : '; finish the front on the next cold spell.');
    }
    if (S.cfm < 1) s += ' At this airflow the fans cool; they do not dry grain safely.';
    out.innerHTML = s;
  }

  /* ---------- share ---------- */
  var lastLine = '';
  function renderShare(now, head) {
    var s = head + (S.place ? ' near ' + S.place : '') + ' (' + MODES[S.mode].toLowerCase() + ', ' + (S.mode === 'cool' ? (S.grainF != null ? 'grain at ' + fmt(S.grainF, 0) + ' F' : 'no grain temperature') : gname() + ', target ' + fmt(target(), 1) + '%' + (S.mode === 'dry' && S.current != null ? ', grain at ' + fmt(S.current, 1) + '%' : '')) + ').';
    if (now && now.emc.ok && S.mode !== 'cool') s += ' ' + fmt(now.tF, 0) + ' F, ' + fmt(now.rh, 0) + '% gives ' + emcText(now.emc) + '.';
    var t = tonight(S.rows || []);
    if (t) s += ' ' + t;
    lastLine = s;
    $('emc-line').textContent = s;
  }
  function shareUrl() {
    return location.origin + location.pathname + '?mode=' + S.mode + '&grain=' + S.grain + '&target=' + fmt(target(), 1) + (S.fan > 0 ? '&fan=' + S.fan : '');
  }
  function copy() {
    var txt = lastLine + ' ' + shareUrl(), btn = $('emc-copy');
    var ok = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy the answer'; }, 2000); };
    var fallback = function () {
      var ta = $('emc-copybox');
      ta.hidden = false; ta.value = txt; ta.focus(); ta.select();
      var done = false;
      try { done = document.execCommand && document.execCommand('copy'); } catch (e) {}
      $('emc-copymsg').textContent = done ? 'Copied.' : 'Your browser would not copy. The answer is selected in the box; copy it from there.';
    };
    if (navigator.share && /Mobi/i.test(navigator.userAgent)) { navigator.share({ text: lastLine, url: shareUrl() }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, fallback); else fallback();
  }

  /* ---------- location and forecast ---------- */
  function status(msg, err) { var s = $('emc-status'); s.textContent = msg || ''; s.className = 'emc-status' + (err ? ' err' : ''); }
  function getJSON(url, ms) {
    var c = typeof AbortController === 'function' ? new AbortController() : null, to;
    var timer = new Promise(function (_, rej) { to = setTimeout(function () { if (c) c.abort(); rej(new Error('timeout')); }, ms || 9000); });
    var req = fetch(url, c ? { signal: c.signal } : {}).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    return Promise.race([req, timer]).then(function (j) { clearTimeout(to); return j; }, function (e) { clearTimeout(to); throw e; });
  }
  function load(lat, lon, label, quiet) {
    var my = ++S.seq;
    if (!quiet) status('Getting the forecast for ' + (label || 'your location') + '…');
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + (+lat).toFixed(3) + '&longitude=' + (+lon).toFixed(3) +
      '&current=temperature_2m,relative_humidity_2m,weather_code&hourly=temperature_2m,relative_humidity_2m,weather_code' +
      '&temperature_unit=fahrenheit&timezone=auto&timeformat=unixtime&forecast_days=4';
    return getJSON(url, 10000).then(function (d) {
      if (my !== S.seq) return;
      var hs = d.hourly || {}, times = hs.time || [];
      var nowMs = Date.now(), hours = [];
      for (var j = 0; j < times.length && hours.length < 72; j++) {
        var t = times[j] * 1000;
        if (t + 3600e3 <= nowMs) continue;
        hours.push({ t: t, tF: val(hs.temperature_2m, j), rh: val(hs.relative_humidity_2m, j), code: val(hs.weather_code, j) });
      }
      if (!hours.length) throw new Error('empty forecast');
      var c = d.current || {};
      S.raw = { now: { tF: val([c.temperature_2m], 0), rh: val([c.relative_humidity_2m], 0), code: val([c.weather_code], 0) }, hours: hours };
      S.tz = typeof d.timezone === 'string' ? d.timezone : null;
      S.fetchedAt = Date.now();
      S.stale = false;
      S.place = label || 'your location';
      S.loc = { lat: +lat, lon: +lon, label: label || null };
      lsSet(LS_LOC, Object.assign(lsGet(LS_LOC) || {}, S.loc));
      $('emc-place').textContent = S.place;
      $('emc-locbox').hidden = true;
      $('emc-change').hidden = false;
      status('');
      render(); renderCooling();
      if (!quiet) { var v = $('emc-verdict'); v.setAttribute('tabindex', '-1'); try { v.focus({ preventScroll: true }); } catch (e) {} }
    }).catch(function () {
      if (my !== S.seq) return;
      if (S.raw && Date.now() - S.fetchedAt > OLD_MS) { S.stale = true; render(); }
      status('Could not get the forecast. The typed-reading box below still works.', true);
      if (!S.raw) $('emc-locbox').hidden = false;
    });
  }
  function val(a, i) { var v = a && a[i]; return typeof v === 'number' && isFinite(v) ? v : null; }
  function refreshIfStale() {
    if (S.loc && S.fetchedAt && Date.now() - S.fetchedAt > STALE_MS) load(S.loc.lat, S.loc.lon, S.loc.label, true);
    else if (S.raw) render();
  }
  function byZip() {
    var z = String($('emc-zip').value || '').replace(/\D/g, '').slice(0, 5);
    if (z.length !== 5) { status('Enter a 5-digit ZIP.', true); return; }
    $('emc-zip').value = z;
    status('Looking up ' + z + '…');
    var my = ++S.seq;
    getJSON(ZIPS + z.slice(0, 2) + '.json', 6000).then(function (t) {
      var p = t && t[z];
      if (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) return { lat: +p[0], lon: +p[1], town: typeof p[2] === 'string' ? p[2] : null };
      throw new Error('not in table');
    }).catch(function () {
      return getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + z + '&count=1&language=en&format=json&countryCode=US', 6000).then(function (d) {
        var r = d && d.results && d.results[0];
        if (!r) throw new Error('none');
        var town = r.name && !/^\d+$/.test(r.name) ? r.name : null;
        return { lat: r.latitude, lon: r.longitude, town: town };
      });
    }).then(function (p) { if (my === S.seq) load(p.lat, p.lon, 'ZIP ' + z + (p.town ? ' (' + p.town + ')' : '')); })
      .catch(function () { if (my === S.seq) status('Could not find ZIP ' + z + '. Check it and try again.', true); });
  }
  function byDevice() {
    if (!navigator.geolocation) { status('This browser cannot share a location. Enter a ZIP.', true); return; }
    status('Waiting for your location…');
    var my = ++S.seq;
    navigator.geolocation.getCurrentPosition(function (p) { if (my === S.seq) load(p.coords.latitude, p.coords.longitude, 'your location'); },
      function () { if (my === S.seq) status('No location came through. Enter a ZIP instead.', true); }, { timeout: 8000, maximumAge: 600000 });
  }

  /* ---------- wire up ---------- */
  function all() { syncInputs(); renderManual(); renderTable(); render(); renderCooling(); }
  function onNum(id, set) { $(id).addEventListener('change', function () { set(numIn(this)); save(); all(); }); }
  function init() {
    readSettings(); syncInputs();
    var bs = document.querySelectorAll('[data-grain]');
    for (var i = 0; i < bs.length; i++) bs[i].addEventListener('click', function () { S.grain = this.getAttribute('data-grain'); save(); all(); });
    var ms = document.querySelectorAll('[data-mode]');
    for (var j = 0; j < ms.length; j++) ms[j].addEventListener('click', function () { S.mode = this.getAttribute('data-mode'); S.sel = -1; save(); all(); });
    var L = E.LIMITS;
    onNum('emc-target', function (v) { var t = inRange(v, L.targetMin, L.targetMax); if (t != null) S.targets[S.grain] = t; else delete S.targets[S.grain]; });
    onNum('emc-fan', function (v) { S.fan = inRange(v, 0, L.fanMax) || 0; });
    onNum('emc-cur', function (v) { S.current = inRange(v, 10, 35); });
    onNum('emc-gt', function (v) { S.grainF = inRange(v, -20, 110); });
    onNum('emc-cfm', function (v) { S.cfm = inRange(v, 0.01, 5); });
    $('emc-gdry').addEventListener('change', function () { S.grainDry = this.checked; save(); all(); });
    ['emc-mt', 'emc-mrh'].forEach(function (id) { $(id).addEventListener('input', renderManual); });
    $('emc-plenum').addEventListener('change', renderManual);
    $('emc-zipgo').addEventListener('click', byZip);
    $('emc-zip').addEventListener('keydown', function (e) { if (e.key === 'Enter') byZip(); });
    $('emc-geo').addEventListener('click', byDevice);
    $('emc-change').addEventListener('click', function () { $('emc-locbox').hidden = false; $('emc-zip').focus(); });
    var st = $('emc-strip');
    st.addEventListener('click', stripPointer);
    st.addEventListener('mousemove', stripPointer);
    st.addEventListener('keydown', function (e) {
      var k = e.key, i = S.sel < 0 ? 0 : S.sel;
      if (k === 'ArrowRight') select(i + 1); else if (k === 'ArrowLeft') select(i - 1);
      else if (k === 'Home') select(0); else if (k === 'End') select((S.rows || []).length - 1); else return;
      e.preventDefault();
    });
    st.addEventListener('focus', function () { if (S.sel < 0) select(0); });
    $('emc-now').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.emc-zw') : null;
      if (!b) return;
      var n = $('emc-zwn');
      if (n) { n.hidden = !n.hidden; b.setAttribute('aria-expanded', n.hidden ? 'false' : 'true'); }
    });
    $('emc-table').addEventListener('toggle', function () { if (this.open && S.rows) drawTable(S.rows); });
    $('emc-copy').addEventListener('click', copy);
    $('emc-print').addEventListener('click', function () { window.print(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshIfStale(); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) refreshIfStale(); });
    renderManual(); renderTable(); renderCooling();
    var loc = lsGet(LS_LOC);
    if (loc && isFinite(loc.lat) && isFinite(loc.lon)) load(loc.lat, loc.lon, loc.label || 'your saved location', true);
    else $('emc-locbox').hidden = false;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
