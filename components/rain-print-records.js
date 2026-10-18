/* components/rain-print-records.js: the optional "remarkable days" layer for
 * Rain Print (/rain-print), 2026-10-13. Detection and data only; the engine
 * (components/rain-print.js) decides what to draw.
 *
 *   AgRainRecords.find(data, opts)    -> [{date, kind, label, value, ...}]
 *   AgRainRecords.explain(data, opts) -> {found, withheld:[{kind, reason}]}
 *   AgRainRecords.elems(kinds)        -> {daily:[...], por:[...]} ACIS elements needed
 *   AgRainRecords.urls(sid, year, kinds), AgRainRecords.load(sid, year, kinds)
 *
 * DATA. data = { year, daily, por, dailyElems, porElems, sid }.
 *   daily: the ACIS StnData response (or its .data rows) for that year,
 *          default columns pcpn,avgt,snow,maxt,mint.
 *   por:   the station's full period-of-record StnData response, default
 *          columns pcpn,avgt. Needed only by the year and month kinds.
 * No new request: the engine already makes both calls (daily: pcpn,avgt,snow;
 * por: pcpn,avgt). It appends the elements elems() names (maxt,mint) to the
 * daily call and keeps the por rows it already downloads. The history is
 * built from those daily rows, not from ACIS monthly summaries, because the
 * S/A accumulation rules below need the flags of single days, and how ACIS
 * sums S days in a reduction was not checked against a live response.
 *
 * RULES (pre-declared; nothing is filled in, nothing is estimated)
 *   Days: M or blank = missing. S = amount rolled into a later A day. A = several
 *   days' catch, never a one-day value. An S run that never closes counts as missing.
 *   Every kind needs a finished year (rows through Dec 31).
 *   A series (pcpn, snow, maxt, mint) with more than MISS_OK (10) missing days
 *   in the year gives no marker of that series.
 *   Full year (rain): at most 10 missing days and no S/A run across Jan 1 or Dec 31.
 *   Full month: at most 3 missing days (rain: and no S/A run across its edges).
 *   "Since": walk back year by year from the year before; every year passed must
 *   be full and settled (drier by more than 0.10 in for "wettest"). A partial year
 *   whose recorded sum already beats the year by more than 0.10 in counts as the
 *   year it is "since"; any other partial or empty year stops the claim there
 *   ("Wettest year from <the year after> to <the year>"). At least 19 settled years,
 *   and 30 full years at the station up to the year, or nothing is said.
 *   Month: ranked against the same calendar month in the station's own full
 *   months up to the year (no later years). Needs 30 full instances. Remarkable
 *   means rank at most max(1, floor(n / 50)) counting values within the band
 *   (0.05 in, 0.5 F) as ties against it: the record when n < 100, top 2%
 *   beyond. 2%, not 5%, because twelve months are checked each year.
 *
 * NOT YET RUN ON LIVE ACIS DATA (2026-10-13): the build sandbox cannot reach
 * data.rcc-acis.org. Tests use fixture responses only.
 */
(function (root) {
  'use strict';
  var MISS_OK = 10, MONTH_MISS = 3, MIN_FULL = 30, MIN_SETTLED = 19, START_MIN = 50, RARE = 50;
  var BAND_YEAR = 0.10, BAND_MONTH = 0.05, BAND_TEMP = 0.5, FROST = 32, SNOW_DAY_MIN = 1.0, DRY_MEDIAN_MIN = 0.50;
  var KINDS = ['coldest', 'hottest', 'lastFrost', 'firstFrost', 'snowDay', 'lastSnow', 'firstSnow', 'wetWeek',
    'wetYear', 'dryYear', 'wetMonth', 'dryMonth', 'warmMonth', 'coldMonth'];
  var HISTORY = { wetYear: 1, dryYear: 1, wetMonth: 1, dryMonth: 1, warmMonth: 1, coldMonth: 1 };
  var NEED = { coldest: 'mint', hottest: 'maxt', lastFrost: 'mint', firstFrost: 'mint', snowDay: 'snow', lastSnow: 'snow', firstSnow: 'snow' };
  var DAILY = ['pcpn', 'avgt', 'snow', 'maxt', 'mint'], POR = ['pcpn', 'avgt'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DEG = '°F';

  // ---------- parsing ----------
  function amt(raw) {   // same reading as RainPrint.parsePcpn
    if (raw === undefined || raw === null) return { v: null, flag: 'M' };
    var s = String(raw).trim();
    if (s === 'T') return { v: 0, flag: 'T' };
    if (s === 'S') return { v: 0, flag: 'S' };
    var v = parseFloat(s);
    if (s === 'M' || isNaN(v)) return { v: null, flag: 'M' };
    return { v: v, flag: /A$/.test(s) ? 'A' : '' };
  }
  function deg(raw) { var v = parseFloat(raw); return raw === undefined || raw === null || isNaN(v) ? null : v; }
  function rowsOf(x) { return Array.isArray(x) ? x : (x && Array.isArray(x.data) ? x.data : []); }
  function r2(x) { return Math.round(x * 100) / 100; }
  function dim(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function ms(d) { return Date.parse(d + 'T00:00:00Z'); }
  function short(d) { return MON[+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)); }
  function ord(k) { var s = ['th', 'st', 'nd', 'rd'], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* Rows -> one entry per calendar day from the first row to the last, with any
     date ACIS left out as a missing day, and S/A runs linked: an S day gets
     .close (index of its A day, or -1 if the run never closes), an A day gets
     .open (index of the run's first S day, or -1 if no S day came before it). */
  function series(rows, elems) {
    var c = {}; elems.forEach(function (e, i) { c[e] = i + 1; });
    rows = rows.filter(function (r) { return r && /^\d{4}-\d\d-\d\d$/.test(r[0]); });
    if (!rows.length) return [];
    var out = [], t0 = ms(rows[0][0]), t1 = ms(rows[rows.length - 1][0]), byDate = {};
    rows.forEach(function (r) { byDate[r[0]] = r; });
    for (var t = t0; t <= t1; t += 86400000) {
      var d = iso(t), r = byDate[d] || [d];
      out.push({ date: d, y: +d.slice(0, 4), m: +d.slice(5, 7) - 1,
        p: amt(c.pcpn ? r[c.pcpn] : null), s: c.snow ? amt(r[c.snow]) : null,
        tx: c.maxt ? deg(r[c.maxt]) : null, tn: c.mint ? deg(r[c.mint]) : null, ta: c.avgt ? deg(r[c.avgt]) : null });
    }
    link(out, 'p'); if (c.snow) link(out, 's');
    return out;
  }
  function link(days, k) {
    var run = -1;
    days.forEach(function (x, i) {
      var f = x[k].flag;
      if (f === 'S') { if (run < 0) run = i; return; }
      if (f === 'A') x[k].open = run;
      for (var j = run; run >= 0 && j < i; j++) days[j][k].close = f === 'A' ? i : -1;
      run = -1;
    });
    for (var j = run; run >= 0 && j < days.length; j++) days[j][k].close = -1;
  }
  // a day whose own amount counts toward a total (S days count 0 when their A closes the run)
  function known(a) { return a && a.v !== null && !(a.flag === 'S' && a.close < 0); }

  // ---------- the station's history, from the por rows ----------
  function history(days) {
    var Y = {};
    function yr(y) {
      return Y[y] || (Y[y] = { sum: 0, ok: 0, split: false, mSum: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        mOk: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], mSplit: [], tSum: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], tN: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    }
    days.forEach(function (x) {
      var o = yr(x.y);
      if (x.ta !== null) { o.tSum[x.m] += x.ta; o.tN[x.m]++; }
      if (!known(x.p)) return;
      o.ok++; o.mOk[x.m]++; o.sum += x.p.v; o.mSum[x.m] += x.p.v;
      if (x.p.flag === 'S') {
        var a = days[x.p.close];
        if (a.m !== x.m || a.y !== x.y) { o.mSplit[x.m] = true; yr(a.y).mSplit[a.m] = true; }
        if (a.y !== x.y) { o.split = true; yr(a.y).split = true; }
      }
    });
    Object.keys(Y).forEach(function (k) {
      var o = Y[k], y = +k, len = dim(y, 1) === 29 ? 366 : 365;
      o.sum = r2(o.sum);
      o.full = len - o.ok <= MISS_OK && !o.split;
      o.month = o.mSum.map(function (s, m) {
        return { rain: r2(s), rainFull: dim(y, m) - o.mOk[m] <= MONTH_MISS && !o.mSplit[m],
          temp: o.tN[m] ? o.tSum[m] / o.tN[m] : null, tempFull: dim(y, m) - o.tN[m] <= MONTH_MISS };
      });
    });
    return Y;
  }

  // "since": see the header. dir 'high' (wettest) or 'low' (driest).
  function chain(H, first, T, t, dir, b) {
    var E = 0;
    for (var y = T - 1; y >= first; y--) {
      var o = H[y];
      if (!o || !o.ok) return { type: 'broken', at: y, E: E };
      var beat = r2(dir === 'high' ? o.sum - t : t - o.sum);   // > 0: that year was more extreme
      if (o.full) {
        /* A "full" past year may still miss up to MISS_OK days. For "wettest",
           what those days could hold (3 times its own daily average each) widens
           the margin before it counts as drier (2026-10-14, panel 3 D5). */
        var len = dim(y, 1) === 29 ? 366 : 365, bb = dir === 'high' && o.ok ? b + (len - o.ok) * (o.sum / o.ok) * 3 : b;
        if (beat > b) return { type: 'since', at: y, E: E };
        if (beat >= -bb) return { type: 'broken', at: y, E: E };   // too close to call
        E++; continue;
      }
      // partial year: its recorded sum is only a lower bound on what fell
      if (r2(o.sum - t) > b) { if (dir === 'high') return { type: 'since', at: y, E: E }; E++; continue; }
      return { type: 'broken', at: y, E: E };
    }
    return { type: 'start', at: first, E: E };
  }

  // ---------- detection ----------
  function nulls(days, f) { var n = 0; days.forEach(function (x) { if (f(x)) n++; }); return n; }
  function tieNote(dates) { return dates.length === 2 ? ' (also ' + short(dates[1]) + ')' : dates.length > 2 ? ' (on ' + dates.length + ' days)' : ''; }

  function extreme(days, key, dir, word) {
    var miss = nulls(days, function (x) { return x[key] === null; });
    if (miss > MISS_OK) return 'temperature missing on ' + miss + ' days';
    var best = null;
    days.forEach(function (x) { var v = x[key]; if (v !== null && (best === null || (dir > 0 ? v > best : v < best))) best = v; });
    if (best === null) return 'no temperature record';
    var dates = days.filter(function (x) { return x[key] === best; }).map(function (x) { return x.date; });
    return { date: dates[0], label: word + ': ' + Math.round(best) + DEG + tieNote(dates), value: best, unit: DEG, ties: dates.slice(1) };
  }

  /* Last frost: the last day Jan 1 to Jul 31 with a low of 32 F or colder; first
     frost: the first such day Aug 1 to Dec 31 (NOAA's split of the year). Withheld
     if any low is missing on the days that could hold a later (or earlier) frost. */
  function frost(days, T, last) {
    var miss = nulls(days, function (x) { return x.tn === null; });
    if (miss > MISS_OK) return 'low temperature missing on ' + miss + ' days';
    var cut = T + '-08-01', i, hit = -1;
    var win = days.filter(function (x) { return last ? x.date < cut : x.date >= cut; });
    if (last) { for (i = win.length - 1; i >= 0 && hit < 0; i--) if (win[i].tn !== null && win[i].tn <= FROST) hit = i; }
    else { for (i = 0; i < win.length && hit < 0; i++) if (win[i].tn !== null && win[i].tn <= FROST) hit = i; }
    if (hit < 0) return last ? 'no low of 32' + DEG + ' or colder before August' : 'no low of 32' + DEG + ' or colder after July';
    var gap = last ? win.slice(hit + 1) : win.slice(0, hit);
    if (gap.some(function (x) { return x.tn === null; })) return 'a missing low could hide ' + (last ? 'a later' : 'an earlier') + ' frost';
    var x = win[hit];
    return { date: x.date, label: (last ? 'Last' : 'First') + ' frost: ' + Math.round(x.tn) + DEG, value: x.tn, unit: DEG };
  }

  function snowGate(days) {
    if (!days.length || days[0].s === null) return 'no snowfall record';
    var miss = nulls(days, function (x) { return !known(x.s); });
    return miss > MISS_OK ? 'snowfall missing on ' + miss + ' days' : '';
  }
  function snowDay(days) {
    var g = snowGate(days); if (g) return g;
    var best = 0, bigA = 0;
    days.forEach(function (x) { if (x.s.v === null) return; if (x.s.flag === 'A') bigA = Math.max(bigA, x.s.v); else best = Math.max(best, x.s.v); });
    if (best < SNOW_DAY_MIN) return 'no day with ' + SNOW_DAY_MIN.toFixed(1) + ' in of snow or more';
    if (bigA >= best) return 'a several-day snowfall total could hide a bigger day';
    var dates = days.filter(function (x) { return x.s.flag !== 'A' && x.s.v === best; }).map(function (x) { return x.date; });
    return { date: dates[0], label: 'Biggest snow: ' + best.toFixed(1) + ' in' + tieNote(dates), value: best, unit: 'in', ties: dates.slice(1) };
  }
  // Last snow: last day Jan 1 to Jul 31 with 0.1 in or more; first snow: first such day from Aug 1.
  function snowDate(days, T, last) {
    var g = snowGate(days); if (g) return g;
    var cut = T + '-08-01', win = days.filter(function (x) { return last ? x.date < cut : x.date >= cut; }), hit = -1, i;
    var snowy = function (x) { return x.s.v !== null && x.s.v >= 0.1; };
    if (last) { for (i = win.length - 1; i >= 0 && hit < 0; i--) if (snowy(win[i])) hit = i; }
    else { for (i = 0; i < win.length && hit < 0; i++) if (snowy(win[i])) hit = i; }
    if (hit < 0) return 'no day with 0.1 in of snow ' + (last ? 'before August' : 'after July');
    var x = win[hit];
    if (x.s.flag === 'A') return 'that snow was a several-day total, so its day is not known';
    var gap = last ? win.slice(hit + 1) : win.slice(0, hit);
    if (gap.some(function (d) { return d.s.v === null || d.s.flag === 'S'; })) return 'a missing snowfall day could hide ' + (last ? 'a later' : 'an earlier') + ' snow';
    return { date: x.date, label: (last ? 'Last' : 'First') + ' snow: ' + x.s.v.toFixed(1) + ' in', value: x.s.v, unit: 'in' };
  }

  /* Wettest week: the most rain in 7 days in a row inside the year. A window counts
     only when every day in it was recorded and every S/A run in it starts and ends
     inside it. The marker spans the window's first to last day with rain. */
  function wetWeek(days) {
    var miss = nulls(days, function (x) { return x.p.v === null; });
    if (miss > MISS_OK) return 'rain missing on ' + miss + ' days';
    var best = -1, wins = [];
    for (var i = 0; i + 7 <= days.length; i++) {
      var sum = 0, ok = true;
      for (var j = i; j < i + 7 && ok; j++) {
        var p = days[j].p;
        if (p.v === null || (p.flag === 'S' && (p.close < 0 || p.close >= i + 7)) || (p.flag === 'A' && p.open < i)) ok = false;
        else sum += p.v;
      }
      if (!ok) continue;
      sum = r2(sum);
      if (sum > best) { best = sum; wins = []; }
      if (sum === best) wins.push(i);
    }
    if (best <= 0) return 'no week with rain';
    var spans = [];
    wins.forEach(function (i) {
      var wet = days.slice(i, i + 7).filter(function (x) { return x.p.v > 0 || x.p.flag === 'S'; });
      var sp = { from: wet[0].date, to: wet[wet.length - 1].date };
      if (!spans.some(function (s) { return s.from <= sp.to && sp.from <= s.to; })) spans.push(sp);
    });
    return { date: spans[0].from, span: spans[0], label: 'Wettest week: ' + best.toFixed(2) + ' in' + tieNote(spans.map(function (s) { return s.from; })),
      value: best, unit: 'in', ties: spans.slice(1).map(function (s) { return s.from; }) };
  }

  function yearFact(H, first, T, dir) {
    var o = H[T], nFull = 0;
    for (var y = first; y <= T; y++) if (H[y] && H[y].full) nFull++;
    if (!o.full) return 'this year is not a full year (' + ((dim(T, 1) === 29 ? 366 : 365) - o.ok) + ' days without a report)';
    if (nFull < MIN_FULL) return 'only ' + nFull + ' full years on record up to ' + T;
    // "driest": this year's own missing days could hold rain; the margin grows by what they could (panel 3 D5)
    var mT = (dim(T, 1) === 29 ? 366 : 365) - o.ok, rate = o.ok ? o.sum / o.ok : 0;
    var c = chain(H, first, T, o.sum, dir, dir === 'low' ? BAND_YEAR + mT * rate * 3 : BAND_YEAR), sup = dir === 'high' ? 'Wettest' : 'Driest';
    if (c.E < MIN_SETTLED) return 'not remarkable: ' + c.E + ' years settled before ' + (c.type === 'since' ? c.at + ' had ' + (dir === 'high' ? 'more' : 'less') : c.type === 'broken' ? c.at + ' could not be compared' : 'the record starts') + ', ' + MIN_SETTLED + ' needed';
    /* 2026-10-17 (farm-buyers panel): "Wetter than any year since 1938" read
       as "1938 was wetter" when 1938 is where the record starts. A claim that
       runs to the record's start says so; one stopped by a patchy year names
       both ends of the years it beat. */
    var label = c.type === 'since' ? sup + ' year since ' + c.at
      : c.type === 'start' && c.E + 1 >= START_MIN ? sup + ' year on record here, back to ' + first
      : c.type === 'start' ? sup + ' year in this station\u2019s record, back to ' + first
      : sup + ' year from ' + (c.at + 1) + ' to ' + T;
    return { date: T + '-01-01', span: { from: T + '-01-01', to: T + '-12-31' }, label: label, value: o.sum, unit: 'in',
      basis: { form: c.type, year: c.type === 'since' ? c.at : null, refValue: c.type === 'since' ? H[c.at].sum : null, settled: c.E, fullYears: nFull, first: first } };
  }

  function monthFact(H, T, key, dir, word) {
    var band = key === 'rain' ? BAND_MONTH : BAND_TEMP, best = null, why = 'no full month this year', ranked = 0;
    for (var m = 0; m < 12; m++) {
      var me = H[T].month[m];
      if (!me[key + 'Full']) continue;
      var t = me[key], vals = [], bandM = band;
      // a dry month with days missing could have been wetter by what they hold, at 3 times the year's daily average (panel 3 D5)
      if (key === 'rain' && dir < 0) { var okM = H[T].mOk[m], missM = dim(T, m) - okM; bandM = band + (H[T].ok ? missM * (H[T].sum / H[T].ok) * 3 : 0); }
      Object.keys(H).forEach(function (k) { var o = H[k].month[m]; if (+k < T && o[key + 'Full']) vals.push(o[key]); });
      var n = vals.length + 1;
      if (n < MIN_FULL) { why = 'fewer than ' + MIN_FULL + ' full ' + MONTH[m] + 's on record'; continue; }
      if (key === 'rain' && dir < 0) {
        var all = vals.concat([t]).sort(function (a, b) { return a - b; }), mid = all.length >> 1;
        var med = all.length % 2 ? all[mid] : (all[mid - 1] + all[mid]) / 2;
        if (med < DRY_MEDIAN_MIN) { why = MONTH[m] + ' is usually too dry for a dry record to mean much'; continue; }
      }
      var more = 0, tied = 0;
      vals.forEach(function (v) { var d = Math.round((dir > 0 ? v - t : t - v) * 1000) / 1000; if (d > bandM) more++; else if (d >= -bandM) tied++; });
      var k = 1 + more, limit = Math.max(1, Math.floor(n / RARE));
      ranked++;
      if (k + tied > limit) continue;
      if (!best || k / n < best.k / best.n) best = { m: m, t: t, k: k, n: n, tied: tied };
    }
    if (!best) return ranked ? 'not remarkable: no month was the record or in the top 2% of its own history' : why;
    var val = key === 'rain' ? best.t.toFixed(2) + ' in' : best.t.toFixed(1) + DEG + ' average';
    var label = cap((best.tied ? 'tied for ' : '') + (best.k > 1 ? ord(best.k) + ' ' : '') + word + ' ' + MONTH[best.m] + ' of ' + best.n + ' full years: ' + val);
    var mm = ('0' + (best.m + 1)).slice(-2);
    return { date: T + '-' + mm + '-01', span: { from: T + '-' + mm + '-01', to: T + '-' + mm + '-' + dim(T, best.m) }, label: label,
      value: key === 'rain' ? best.t : Math.round(best.t * 10) / 10, unit: key === 'rain' ? 'in' : DEG, basis: { rank: best.k, tied: best.tied, of: best.n } };
  }

  function explain(data, opts) {
    data = data || {}; opts = opts || {};
    var T = +data.year, kinds = opts.kinds ? opts.kinds.slice() : KINDS.slice(), found = [], withheld = [];
    function hold(k, r) { withheld.push({ kind: k, reason: r }); }
    kinds.filter(function (k) { return KINDS.indexOf(k) < 0; }).forEach(function (k) { hold(k, 'unknown kind'); });
    kinds = KINDS.filter(function (k) { return kinds.indexOf(k) >= 0; });
    var dElems = data.dailyElems || DAILY;
    var days = series(rowsOf(data.daily).filter(function (r) { return String(r[0]).slice(0, 4) === String(T); }), dElems);
    var done = days.length && days[0].date === T + '-01-01' && days[days.length - 1].date === T + '-12-31';
    var H = null, first = null, hWhy = '';
    if (kinds.some(function (k) { return HISTORY[k]; })) {
      var sid = String(data.sid || opts.sid || '');
      // Rows after the year are read only to see whether an S run on Dec 31 closes
      // in January (then the year is not full); no value after the year is compared.
      var all = series(rowsOf(data.por), data.porElems || POR);
      if (/ 9$/.test(sid)) hWhy = 'this record joins several weather stations';
      else if (!all.length || all[all.length - 1].y < T) hWhy = 'the station history does not reach ' + T;
      else {
        H = history(all); first = all[0].y;
        if (done && dElems.indexOf('pcpn') >= 0) {   // both sides from one record: the year call must agree with the history
          var a = raw(days), b = raw(all.filter(function (x) { return x.y === T; }));
          if (Math.abs(a.sum - b.sum) > 0.005 || a.n !== b.n) { H = null; hWhy = 'the station record changed between requests'; }
        }
      }
    }
    kinds.forEach(function (k) {
      var need = NEED[k], r;
      if (!done) return hold(k, 'the year is not finished');
      if (need && dElems.indexOf(need) < 0) return hold(k, 'no ' + need + ' in the data');
      if (HISTORY[k] && !H) return hold(k, hWhy);
      switch (k) {
        case 'coldest': r = extreme(days, 'tn', -1, 'Coldest day'); break;
        case 'hottest': r = extreme(days, 'tx', 1, 'Hottest day'); break;
        case 'lastFrost': r = frost(days, T, true); break;
        case 'firstFrost': r = frost(days, T, false); break;
        case 'snowDay': r = snowDay(days); break;
        case 'lastSnow': r = snowDate(days, T, true); break;
        case 'firstSnow': r = snowDate(days, T, false); break;
        case 'wetWeek': r = wetWeek(days); break;
        case 'wetYear': r = yearFact(H, first, T, 'high'); break;
        case 'dryYear': r = yearFact(H, first, T, 'low'); break;
        case 'wetMonth': r = monthFact(H, T, 'rain', 1, 'wettest'); break;
        case 'dryMonth': r = monthFact(H, T, 'rain', -1, 'driest'); break;
        case 'warmMonth': r = monthFact(H, T, 'temp', 1, 'warmest'); break;
        case 'coldMonth': r = monthFact(H, T, 'temp', -1, 'coldest'); break;
      }
      if (typeof r === 'string') hold(k, r); else { r.kind = k; found.push(r); }
    });
    return { found: found, withheld: withheld };
  }
  function raw(days) { var sum = 0, n = 0; days.forEach(function (x) { if (x.p.v !== null) { n++; sum += x.p.v; } }); return { sum: r2(sum), n: n }; }
  function find(data, opts) { return explain(data, opts).found; }

  // ---------- requests ----------
  function elems(kinds) {
    kinds = kinds || KINDS;
    var d = ['pcpn'];
    kinds.forEach(function (k) { if (NEED[k] && d.indexOf(NEED[k]) < 0) d.push(NEED[k]); });
    var hist = kinds.some(function (k) { return HISTORY[k]; });
    return { daily: d, por: hist ? POR.slice() : [] };
  }
  function urls(sid, year, kinds) {
    var base = 'https://data.rcc-acis.org/StnData?', e = elems(kinds);
    return { daily: base + new URLSearchParams({ sid: sid, sdate: year + '-01-01', edate: year + '-12-31', elems: DAILY.join(',') }),
      por: e.por.length ? base + new URLSearchParams({ sid: sid, sdate: 'por', edate: 'por', elems: POR.join(',') }) : null };
  }
  // One in-memory promise per URL; the por URL does not depend on the year, so every year at a station shares it.
  var CACHE = new Map();
  function getJson(u) {
    if (!CACHE.has(u)) CACHE.set(u, root.fetch(u).then(function (r) { if (!r.ok) throw new Error('ACIS error ' + r.status); return r.json(); })
      .catch(function (e) { CACHE.delete(u); throw e; }));
    return CACHE.get(u);
  }
  function load(sid, year, kinds) {
    var u = urls(sid, year, kinds);
    return Promise.all([getJson(u.daily), u.por ? getJson(u.por) : null]).then(function (j) {
      return { year: year, sid: sid, daily: j[0], por: j[1], dailyElems: DAILY, porElems: POR };
    });
  }

  root.AgRainRecords = { find: find, explain: explain, elems: elems, urls: urls, load: load, KINDS: KINDS.slice(),
    MISS_OK: MISS_OK, _chain: chain, _history: history, _series: series };
})(typeof window !== 'undefined' ? window : this);
