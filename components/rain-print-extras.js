/* components/rain-print-extras.js: the Rain Print options Sig added on 2026-10-17.
 * Pure arithmetic, no fetching and no drawing: the engine (components/rain-print.js)
 * feeds it the station rows it already read, and hands the answers to the art
 * (components/rain-print-art.js).
 *
 *   AgRainExtras.tempDays(rows, year, cols)       the year's highs and lows by day of the year
 *   AgRainExtras.tempGaps(td, from, to)           days with no high or no low in a span
 *   AgRainExtras.gduDay(hi, lo)                   one day's growing degree days, 86/50
 *   AgRainExtras.cropStages(kind, td, plant, harvest)   the stages the season reached, and when
 *   AgRainExtras.normalTemps(rows, year)          NOAA 1991-2020 daily normal highs and lows, same shape as tempDays
 *   AgRainExtras.compare(stages, ghost, key)      "N days ahead of / behind a usual year" for the key stage
 *   AgRainExtras.fullYears(rows, col)             every full year of a station's daily record, as running totals
 *   AgRainExtras.remarkableYears(full, year)      the 2 wettest and 2 driest of the other full years
 *   AgRainExtras.rank(full, year)                 where the year stands among the full years
 *   AgRainExtras.ribbonScale(td)                  the old temperature band's scale, in round tens (kept for the tests)
 *   AgRainExtras.stripes(td, tdN)                 the temperature stripes: each day's average against its normal
 *
 * CROP STAGES (Sig, 2026-10-17). Corn and soybeans only. Growing degree days are
 * the GDU calculator's (/gdu-calculator): the day's high and low each held
 * between 50 and 86 F, averaged, less 50; counted from the planting day itself
 * (the calculator's weather starts on the planting date); the stage thresholds
 * are components/gdu-stages.js, the site's one table (corn: Purdue NCH-40 Table 3,
 * cumulative GDU from planting for a 2,700 GDU hybrid; soybeans: emergence and V3
 * only, since flowering and maturity follow day length and variety, not heat alone). A day with no high
 * or no low stops the count there: no stage after it is claimed, and nothing is
 * filled in. A stage past the harvest day is not drawn.
 *
 * Sunflowers are not offered. NDSU publishes sunflower stages by growing degree
 * days (base 44 F): NDAWN's "Sunflower Development and Growing Degree Days"
 * (https://ndawn.ndsu.nodak.edu/help-sunflower-growing-degree-days.html) and the
 * NDSU Crop and Pest Report of 2021-07-21. Neither page could be read from the
 * build machine, and search summaries quote two NDSU editions that disagree by
 * 130 to 160 GDD (VE 206 / R1 1,048 / R9 2,310 against the 2007 handbook's
 * 167 / 919 / 2,470), so no sunflower number goes on a print until the source
 * itself is read (references/sources.json: ndawn-sunflower-gdd, ndsu-cpr-sunflower-gdd).
 *
 * HISTORY (every year behind your year). A full year has a report for every day
 * (no M, no missing row), and any S run (amount reported later) closes inside
 * the year. The other full years draw as threads; the 2 wettest and 2 driest of
 * them get their year written at the end of the thread. The rank counts the full
 * years the station has kept, the buyer's among them, and only when the buyer's
 * year is itself full; a tie is said as a tie.
 */
(function (root) {
  'use strict';

  var GS = function () { return root.AgGduStages || null; };
  var BASE = 50, CAP = 86;
  /* What each crop shows: five stages a reader knows by sight, the key one that
     gets the "days ahead" note, and the words for the print's foot line. */
  var CROPS = {
    corn: {
      name: 'Corn', table: 'corn', key: 'R1',
      picks: [['VE', 'Emerged'], ['V6', 'V6'], ['R1', 'Silk'], ['R5', 'Dent'], ['R6', 'Black layer']],
      foot: 'Corn stages: growing degree days (86/50) from planting; stage GDUs for a 2,700 GDU hybrid (Purdue NCH-40)'
    },
    /* Soybeans: emergence and V3 only (2026-10-17, review). Flowering, pod fill and maturity follow day length
       and maturity group, so a heat-only count puts them weeks early (R7 on Aug 4 for May 10 beans in 2012,
       when Iowa beans reach it in September); they are not drawn, and the foot line says so. */
    soy: {
      name: 'Soybeans', table: 'bean', key: 'V3',
      picks: [['VE', 'Emerged'], ['V3', 'V3']],
      foot: 'Soybean stages: growing degree days (86/50) from planting; soybean flowering and maturity depend on day length and variety, so they are not drawn'
    }
  };
  var KINDS = ['corn', 'soy'];

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function doyOf(year, iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m || +m[1] !== +year) return -1;
    return Math.round((Date.UTC(+year, +m[2] - 1, +m[3]) - Date.UTC(+year, 0, 1)) / 86400000);
  }
  function isoOf(year, doy) { return new Date(Date.UTC(+year, 0, 1) + doy * 86400000).toISOString().slice(0, 10); }
  function deg(raw) {
    if (raw === undefined || raw === null) return null;
    var s = String(raw).trim();
    if (s === '' || s === 'M') return null;
    var v = parseFloat(s);
    return isNaN(v) ? null : v;
  }

  /* rows: ACIS StnData rows; cols: {maxt, mint} column indexes (default 4 and 5,
     the engine's pcpn,avgt,snow,maxt,mint call). Out: {year, n, hi: [], lo: []}
     with null on a day with no reading. A date ACIS left out is a null too. */
  function tempDays(rows, year, cols) {
    cols = cols || { maxt: 4, mint: 5 };
    var n = isLeap(+year) ? 366 : 365, hi = [], lo = [];
    for (var i = 0; i < n; i++) { hi.push(null); lo.push(null); }
    (rows || []).forEach(function (r) {
      if (!r) return;
      var k = doyOf(year, r[0]);
      if (k < 0) return;
      hi[k] = deg(r[cols.maxt]); lo[k] = deg(r[cols.mint]);
    });
    return { year: +year, n: n, hi: hi, lo: lo };
  }
  // NOAA 1991-2020 normal highs and lows (ACIS normal "91"): rows of [date, maxt normal, mint normal]
  function normalTemps(rows, year) { return tempDays(rows, year, { maxt: 1, mint: 2 }); }
  function tempGaps(td, from, to) {
    var g = 0;
    if (!td) return Infinity;
    for (var i = Math.max(0, from); i <= Math.min(td.n - 1, to); i++) if (td.hi[i] === null || td.lo[i] === null) g++;
    return g;
  }
  function gduDay(hi, lo) {
    var h = Math.min(Math.max(hi, BASE), CAP), l = Math.min(Math.max(lo, BASE), CAP);
    return (h + l) / 2 - BASE;
  }

  /* kind 'corn' | 'soy'; td from tempDays; plant and harvest: ISO dates in td's year.
     -> {kind, stages: [{key, label, gdu, doy, date}], stop: null | 'missing' | 'harvest' | 'year',
         stopDate, gdu (counted through the last day used)} or null for an unknown crop. */
  function cropStages(kind, td, plant, harvest) {
    var C = CROPS[kind], g = GS();
    if (!C || !g || !td) return null;
    var table = g[C.table], a = doyOf(td.year, plant), b = doyOf(td.year, harvest);
    if (a < 0 || b < 0 || b <= a) return null;
    var want = C.picks.map(function (p) {
      var row = table.filter(function (t) { return t.s === p[0]; })[0];
      return { key: p[0], label: p[1], gdu: row.gdu };
    });
    var out = { kind: kind, stages: [], stop: null, stopDate: null, gdu: 0 }, c = 0, j = 0, i;
    for (i = a; i <= b && j < want.length; i++) {
      if (i >= td.n) { out.stop = 'year'; break; }
      var hi = td.hi[i], lo = td.lo[i];
      if (hi === null || lo === null) { out.stop = 'missing'; out.stopDate = isoOf(td.year, i); break; }
      c += gduDay(hi, lo);
      while (j < want.length && c >= want[j].gdu) {
        out.stages.push({ key: want[j].key, label: want[j].label, gdu: want[j].gdu, doy: i, date: isoOf(td.year, i) });
        j++;
      }
    }
    if (!out.stop && j < want.length) out.stop = 'harvest';
    out.gdu = Math.round(c);
    return out;
  }
  /* The key stage's days ahead of (or behind) the same crop on a usual year's
     temperatures. Only when both reached it; 0 days says "same day as". */
  function compare(stages, ghost, key) {
    if (!stages || !ghost) return null;
    var a = stages.stages.filter(function (s) { return s.key === key; })[0], b = ghost.stages.filter(function (s) { return s.key === key; })[0];
    if (!a || !b) return null;
    var d = b.doy - a.doy, n = Math.abs(d);
    return { key: key, days: d, text: d === 0 ? 'Same day as a usual year' : n + (n === 1 ? ' day ' : ' days ') + (d > 0 ? 'ahead of' : 'behind') + ' a usual year' };
  }

  // ---------- every year behind your year ----------
  function amt(raw) {
    if (raw === undefined || raw === null) return { v: null, f: 'M' };
    var s = String(raw).trim();
    if (s === 'T') return { v: 0, f: 'T' };
    if (s === 'S') return { v: 0, f: 'S' };
    var v = parseFloat(s);
    if (s === 'M' || s === '' || isNaN(v)) return { v: null, f: 'M' };
    return { v: v, f: /A$/.test(s) ? 'A' : '' };
  }
  /* rows: the station's period-of-record rows; col: the pcpn column (1).
     -> [{year, total, cum: [running total by day of the year]}], oldest first. */
  function fullYears(rows, col) {
    col = col || 1;
    var by = {}, order = [];
    (rows || []).forEach(function (r) {
      if (!r || !/^\d{4}-\d\d-\d\d$/.test(r[0])) return;
      var y = +r[0].slice(0, 4);
      if (!by[y]) { by[y] = {}; order.push(y); }
      by[y][r[0]] = r[col];
    });
    var out = [];
    order.forEach(function (y) {
      var n = isLeap(y) ? 366 : 365, cum = [], c = 0, open = false, ok = true;
      for (var i = 0; i < n && ok; i++) {
        var d = isoOf(y, i), a = amt(by[y][d]);
        if (!(d in by[y]) || a.v === null) { ok = false; break; }
        // an S run must close with its A day; one followed by anything else never closed (its rain is lost)
        if (a.f === 'S') open = true;
        else { if (open && a.f !== 'A') { ok = false; break; } open = false; }
        c += a.v;
        cum.push(Math.round(c * 1000) / 1000);
      }
      if (ok && !open) out.push({ year: y, total: Math.round(c * 100) / 100, cum: cum });
    });
    return out.sort(function (p, q) { return p.year - q.year; });
  }
  // the 2 wettest and 2 driest of the full years other than the buyer's (their years, for the threads' labels)
  function remarkableYears(full, year) {
    var others = (full || []).filter(function (f) { return f.year !== +year; });
    if (others.length < 4) return { wet: [], dry: [] };
    var s = others.slice().sort(function (p, q) { return p.total - q.total || p.year - q.year; });
    return { dry: [s[0].year, s[1].year], wet: [s[s.length - 1].year, s[s.length - 2].year] };
  }
  function ord(k) { var s = ['th', 'st', 'nd', 'rd'], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); }
  /* -> {n, rank, dir: 'driest' | 'wettest', tied, text} or null when the year isn't full.
     Ranked from whichever end it is nearer (the driest half from the dry end). */
  function rank(full, year) {
    full = full || [];
    var me = full.filter(function (f) { return f.year === +year; })[0];
    if (!me || full.length < 2) return null;
    var lt = 0, gt = 0, eq = 0;
    full.forEach(function (f) { if (f.year === me.year) return; if (Math.abs(f.total - me.total) < 0.005) eq++; else if (f.total < me.total) lt++; else gt++; });
    var dry = lt <= gt, r = (dry ? lt : gt) + 1, dir = dry ? 'driest' : 'wettest', n = full.length;
    var text = (eq ? 'Tied for ' : '') + (r === 1 ? (eq ? 'the ' : 'The ') + dir : ord(r) + ' ' + dir) + ' of the ' + n + ' full years this station has kept';
    if (!eq && r !== 1) text = text.charAt(0).toUpperCase() + text.slice(1);
    return { n: n, rank: r, dir: dir, tied: eq > 0, text: text };
  }

  // ---------- the temperature ribbon ----------
  /* The year's own range, out to round tens (at least 40 degrees), or null with
     fewer than half the days read. */
  function ribbonScale(td) {
    if (!td) return null;
    var lo = null, hi = null, n = 0;
    for (var i = 0; i < td.n; i++) {
      if (td.hi[i] === null || td.lo[i] === null) continue;
      n++;
      if (hi === null || td.hi[i] > hi) hi = td.hi[i];
      if (lo === null || td.lo[i] < lo) lo = td.lo[i];
    }
    if (n < td.n / 2) return null;
    var a = Math.floor(lo / 10) * 10, b = Math.ceil(hi / 10) * 10;
    if (b - a < 40) b = a + 40;
    return { lo: a, hi: b, days: n };
  }

  // ---------- the temperature stripes (option C, Sig 2026-10-21) ----------
  /* td: the year (tempDays); tdN: the same station's 1991-2020 normals (normalTemps), same days.
     Each day's average (high plus low, halved) less the normal average for that date, in °F to a tenth.
     A day with no high, no low, no normal high or no normal low is null: left blank, never filled.
     -> {dev: [], days (with a stripe), blank (without)} or null with no normals or fewer than half the days. */
  function stripes(td, tdN) {
    if (!td || !tdN || !tdN.hi || !tdN.lo) return null;
    var dev = [], n = 0;
    for (var i = 0; i < td.n; i++) {
      var h = td.hi[i], l = td.lo[i], nh = tdN.hi[i], nl = tdN.lo[i];
      if (h === null || l === null || nh === null || nl === null || nh === undefined || nl === undefined) { dev.push(null); continue; }
      dev.push(Math.round(((h + l) / 2 - (nh + nl) / 2) * 10) / 10); n++;
    }
    if (n < td.n / 2) return null;
    return { dev: dev, days: n, blank: td.n - n };
  }

  root.AgRainExtras = {
    CROPS: CROPS, KINDS: KINDS, BASE: BASE, CAP: CAP, SUNFLOWERS: false,
    tempDays: tempDays, normalTemps: normalTemps, tempGaps: tempGaps, gduDay: gduDay, cropStages: cropStages, compare: compare,
    fullYears: fullYears, remarkableYears: remarkableYears, rank: rank, ribbonScale: ribbonScale, stripes: stripes, doyOf: doyOf, isoOf: isoOf
  };
})(typeof window !== 'undefined' ? window : this);
