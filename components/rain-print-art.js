/* components/rain-print-art.js: the two Rain Print styles Sig picked (2026-10-13).
 *
 *   R1 "Staircase" (default): the running total across the year, the verdict and
 *      both year totals upper left, the chart full width, a step that came as
 *      snow in ice blue on the line (nothing under the axis), the name (the
 *      biggest words on the sheet), place and year bottom left.
 *   R2 "Roots": snow piles up above the ground line, rain soaks down below it,
 *      month totals across the top, a quiet depth scale.
 *
 * Pure: AgRainArt.render(input) -> an SVG string on a 1800 x 1200 viewBox
 * (18 x 12 in, 100 units per inch). The engine (components/rain-print.js)
 * builds `input` from the station's days; nothing here fetches anything.
 *
 * input = {
 *   style: 'r1' | 'r2', year, place (long form, "Chetek, Wisconsin"), name, dedication,
 *   days: engine days [{date, v, flag, s, m, doy}], D: RainPrint.derive(days),
 *   axisLen: days on the x axis (a preview lays out the whole calendar year),
 *   showDry: RainPrint.showDry(D), whether the longest dry stretch is marked,
 *   ov: the comparison {daily (0 on unrecorded days), total} or null,
 *   ovNote: what "usual" means, printed in the foot line ("A usual year: NOAA’s 30-year normal"),
 *   printDryMin: Staircase marks a dry stretch on the print from this many days (default 14),
 *   showNormals: month normals under the month totals,
 *   markers: [{doy, label}] (up to 5; see lastUnplaced), records: AgRainRecords.find() output or [],
 *   qr: {matrix, serial} or null, preview: {last ISO, later (optional words)} or null,
 *   logo: {href (a data:image/png URL), w, h (its pixels)} or null: the buyer's
 *     farm or business logo (2026-10-14), small, beside the name block. The
 *     engine hands over the stored PNG, or its one-color ink version.
 *     later is for the gift card only (rp-gift.html, 2026-10-14): a pale wash over
 *     the months still to come with those words in it. The page never sets it.
 *   watermark, bleed (units), px [w, h], fontCss, measure(text, font) -> width
 * }
 * render() also returns what it could not place: AgRainArt.lastSkipped().
 *
 * RULES carried from the engine: an unrecorded or S day is a gap (no step, no
 * bar, ground line broken), never a dry day; the comparison is 0 on those days,
 * so both totals leave them out; an A total is never the biggest rain, and when
 * the snow record is whole neither is a snow day (D.maxRain, Sig); a dry
 * stretch is marked only when the engine's showDry says so (7 days or more),
 * and on Staircase only from printDryMin days (14 unless the page says).
 */
(function (root) {
  'use strict';

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PT = 1.389;
  var C = {
    ink: '#1E2125', mute: '#5E6475', soft: '#8A8F98', guide: '#D6D9D2', grid: '#E4E6E1',
    rain: '#2B5C8A', bar: '#26313D', snowLine: '#8DB6D8', snowFill: '#AFCBE2', snowEdge: '#5F8DB3', snowInk: '#4F7FA6', snowGrid: '#DCE6EE',
    accent: '#A8321E', dryBand: '#F3E2DF', wetBand: '#DDE5EC', rec: '#3F4651'
  };
  var QR_INK = '#A4A89F', SERIAL_INK = '#8E9289';
  var SANS = "'IBM Plex Sans',system-ui,sans-serif", SERIF = "'Fraunces',Georgia,serif";
  var W0 = 1800, H0 = 1200;

  var n2 = function (v) { return +(+v).toFixed(2); };
  var f2 = function (v) { return (+v).toFixed(2); };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  /* ---------- units and language (2026-10-16, Rain Print for Canada) ----------
     input.loc = {units: 'in' | 'mm', lang: 'en' | 'fr'}; missing means inches and
     English, the print as it always was. The engine's numbers stay in inches;
     only what is printed changes: rain in mm (year and month totals whole, a
     day to a tenth), snowfall in cm, French words (fr-CA, the strings in FR
     below, marked for a native speaker's review in the plan). French puts a
     space before : and %, a comma for the decimal point, a space between
     thousands, and the day before the month ("3 mai"). */
  var LOC = { mm: false, fr: false };
  var MON_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var MONCAP_FR = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUILL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
  /* FR-REVIEW: every French string on the print. Keys are the English words. */
  var FR = {
    'rain and melted snow': 'pluie et neige fondue', 'rain': 'pluie', 'precipitation': 'précipitations',
    'Biggest rain': 'Plus grosse pluie', 'Wettest day': 'Journée la plus arrosée',
    'About a usual year': 'Près d’une année normale',
    'Days with rain': 'Jours de pluie', 'Days with rain or snow': 'Jours de pluie ou de neige',
    'Snow': 'Neige', 'light blue: snow': 'bleu pâle : neige',
    'This station’s snowfall record has holes, so no snow is drawn; melted snow is counted in the total':
      'Les relevés de neige de cette station ont des trous, donc la neige n’est pas dessinée; la neige fondue est comptée dans le total',
    'This station doesn’t report snowfall; melted snow is counted in the total':
      'Cette station ne mesure pas la neige; la neige fondue est comptée dans le total',
    'Light blue above the ground is snow, dark bars below it are rain': 'Bleu pâle au-dessus du sol : neige; barres foncées dessous : pluie',
    'Dark blue steps are rain, light blue steps are snow': 'Marches bleu foncé : pluie; marches bleu pâle : neige',
    'your year, rain and melted snow': 'votre année, pluie et neige fondue', 'your year, rain': 'votre année, pluie', 'your year': 'votre année',
    'a usual year by then': 'une année normale à cette date', 'a usual year, same days': 'une année normale, mêmes jours', 'a usual year': 'une année normale',
    'this year': 'cette année', 'so far': 'jusqu’ici',
    'usual': 'normale', 'SNOWFALL': 'NEIGE', 'snow': 'neige', 'PREVIEW': 'APERÇU'
  };
  function tr(en) { return LOC.fr && FR[en] !== undefined ? FR[en] : en; }
  function setLoc(l) { l = l || {}; LOC = { mm: l.units === 'mm', fr: l.lang === 'fr' }; }
  // a number as the print writes it: d decimals, French comma and spaces, English commas over 9,999
  function num(v, d) {
    var s = (+v).toFixed(d), p = s.split('.'), neg = p[0].charAt(0) === '-', i = neg ? p[0].slice(1) : p[0];
    if (i.length > (LOC.fr ? 3 : 4)) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, LOC.fr ? ' ' : ',');
    return (neg ? '-' : '') + i + (p[1] ? (LOC.fr ? ',' : '.') + p[1] : '');
  }
  var MM = 25.4, CM = 2.54;
  // rain: kind 'tot' (the year, a month) or 'day'; snow in snowAmt
  function rainNum(inches, kind) { return LOC.mm ? num(inches * MM, kind === 'day' ? 1 : 0) : num(inches, 2); }
  function snowNum(inches) { return LOC.mm ? num(inches * CM, 0) : num(inches, 1); }
  function rU() { return LOC.mm ? 'mm' : 'in'; }
  function sU() { return LOC.mm ? 'cm' : 'in'; }
  function rainAmt(inches, kind) { return rainNum(inches, kind) + ' ' + rU(); }
  function snowAmt(inches) { return snowNum(inches) + ' ' + sU(); }
  // "Snow: 8.0 in" / "Neige : 20 cm": French puts a space before the colon
  function colon(words) { return words + (LOC.fr ? ' : ' : ': '); }
  function pctText(p) { return LOC.fr ? p + ' %' : p + '%'; }

  function fmtDate(iso) { var p = String(iso).split('-').map(Number); return LOC.fr ? (p[2] === 1 ? '1er' : p[2]) + ' ' + MON_FR[p[1] - 1] : MON[p[1] - 1] + ' ' + p[2]; }
  function fmtRange(a, b) {
    var A = String(a).split('-').map(Number), B = String(b).split('-').map(Number);
    if (LOC.fr) return A[1] === B[1] ? 'du ' + (A[2] === 1 ? '1er' : A[2]) + ' au ' + B[2] + ' ' + MON_FR[B[1] - 1] : 'du ' + fmtDate(a) + ' au ' + fmtDate(b);
    return A[1] === B[1] ? MON[A[1] - 1] + ' ' + A[2] + ' to ' + B[2] : MON[A[1] - 1] + ' ' + A[2] + ' to ' + MON[B[1] - 1] + ' ' + B[2];
  }
  function monCap(m) { return LOC.fr ? MONCAP_FR[m] : MON[m].toUpperCase(); }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function doyOf(year, iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m || +m[1] !== +year) return -1;
    return Math.round((Date.UTC(year, +m[2] - 1, +m[3]) - Date.UTC(year, 0, 1)) / 86400000);
  }

  // every part of the art sits in a group named for what it belongs to (data-rp): a label, its leader and its mark share one
  var G0 = function (k) { return '<g data-rp="' + k + '">'; }, G1 = '</g>';
  // ---------- text measurement ----------
  /* In the browser a canvas measures with the page's own fonts (the engine waits
     for them before drawing; canvas and SVG text agree to the unit, checked in
     Chromium 2026-10-13). Without one (tests, or a canvas that fails), roughW
     reads a width table measured from the print's own font files: per glyph, the
     widest it gets at any size the print uses, plus 1%, so the fallback never
     makes a label look narrower than it prints. (The old per-class guess ran up
     to 38% short on capitals and digits; 2026-10-13.) */
  var canvasCtx = null;
  var WT = {
    "chars": " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~°·’‘“”éèáàâäãåçêëíìîïñóòôöõúùûüýÿÉÈÁÀÂÄÇÑÓÖÜ–",
    "F300": "6k8e8fhyg9jkkc3v9898hkfj6dby63drhic2g2egfsfafwdlfcg26b6leafjeacvnxjdi7jclhhrg8l1mna0c1kegtohlwm8hsm8j0g1ickpj7s9k3ixho8ndq8pdnd15werg5dvgjec9if6gy8080g584pqgyg3gkg5bzcm9jghf7m3eaf5cvak6vakhyb4775759a5avececererererererdvecec83838383gyg3g3g3g3g3ghghghghf5f5hrhrjdjdjdjdjclwm8m8kpdy",
    "F400": "6d8q9hi9gmktkw4g9r9rhkfo75bs6vdwi9cngpf6gqfwgne8gdgr717begfoegdwowk2j2jklzi6grlanbaqd8ldhbp9lumbipmbk3glizkxjrt1kdj6hw97dw9bdldg6hfagoebh2eoacfqhi8i8igr8lqdhigfh4gocqd6a9h4fhmtexfmdday7gayhzb57p5y5zboc7eoeofafafafafafaebeoeo8i8i8i8ihigfgfgfgfgfh4h4h4h4fmfmi6i6k2k2k2k2jklumbmbkxei",
    "F400i": "5r8v9ri5g8kkjs4qa9a6hhfi6sax6lcpi8c7gjf0fxflgnenfvgn7x89egfoegdmoti1imi5l1hngwjqm3alaajzfqntjxlkiflkj9g4ghjuhlqsiaggh2ahc4ahd0cv6hfgfkctftdo90eng88w8lfi8unwgmevfff4d6c8ajgkfmmugfeedyba92b8hjb17k5q5wbfb8dodofgfgfgfgfgfgctdodo8v8v8v8vgmevevevevevgkgkgkgkeeeehnhni1i1i1i1i5jwlklkjueg",
    "F500": "698wa0ifgslel64qa0a0hkfq7kbp78dyimcxh2fjh8g8h1ejgwh57e7pejfqejegpekejijpm7ieh1lfnnb3duluhkpoltmdj6mdkngujbl1k0tfkhjbi09hdy9mdkdn6rfjgyejhbevaqfzht8q8qh28tqphtglhdgyd4dhamhffnn6f8fudmb47qb4i0b57y6b6ccfcvevevfjfjfjfjfjfjejevev8p8p8p8phtglglglglglhfhfhfhffufuieiekekekekejpltmdmdl1es",
    "F600": "6692aiilh0m0lf50a9a9hkft7ybm7me1j0d7hefwhpgjhfeuhehi7r82elfteleypvkrjzjtmgilhaljnzbiegmbhsq3lsmejmmel6h5jml4k9tukmjfi49re19xdidu72fth7erhkf1b5g9i38y8yhd90r0i3gshmh8dhdrayhqfsnjfkg3dvbc81bci0b5876o6pd6djf1f1ftftftftftfterf1f18w8w8w8wi3gsgsgsgsgshqhqhqhqg3g3ililkrkrkrkrjtlsmemel4f1",
    "S300": "6n7nbak1g8pjja6k9e9ebpgu7bb57ba0gugugugugugugugugugu7v7vgugugud6owhkhxhcipg4fgj7jpaxdth5dsmnjpjkgwjkhvfyfxirgootgmg5g08ra08rgufxgueug4dyg4f98peuft6u6uef7fokftfig4g4a1de9fftddl3dudicj9c7z9cgud48v7b7bcjcif9f9eueueueueueudyf9f96u6u6u6uftfifififififtftftftdidig4g4hkhkhkhkhcjpjkjkirgi",
    "S400": "6n7zbsk1gsq1jh6t9f9fcngu7nb77nargugugugugugugugugugu8787gugugudep0i0ichgiugdfpjijvb8echte3mtjvjwh1jwhzgbg2j1h4p0h8gnga8xar8xgufvguf0gae5gaff94eufy7171et7noifyfqgagaabdo9vfydtlke9e0d19n8u9ngud5967o7odcdbfffff0f0f0f0f0f0e5ffff71717171fyfqfqfqfqfqfyfyfyfye0e0gdgdi0i0i0i0hgjvjwjwj1gi",
    "S400i": "6n7mbij4g9p9it6k9898cpgu7oav7oamgugugugugugugugugugu8888gugugud7o8hihmgxibfvf8ikj7avdzhadqm0j7j2gij2hkg7fnifgno7gqg7ft8xam8wgufegngdg2dpgded8neafv7f74el7fntfvfgg2g2a8d890fsdlksdvdlcl998m99gucr8w7o7od7d7ededgdgdgdgdgdgddpeded7f7f7f7ffvfgfgfgfgfgfsfsfsfsdldlfvfvhihihihigxj7j2j2iffv",
    "S500": "6n8ecnj1gtqlju749g9geggu83ba83bpgugugugugugugugugugu8o8ogugugudop5ijiihtj5gng0jtk2bnexikefmwk2jyhmjyiegtg7j8hmq0hxhcgm94bp94gufrguffgmebgmfk9kf4ga7g7gfe80orgafsgmgmardva9gaedmfevegdo9z9w9zgud69k8080e1e1fkfkffffffffffffebfkfk7g7g7g7ggafsfsfsfsfsgagagagaegeggngnijijijijhtk2jyjyj8gi",
    "S600": "6n8pd8ifguqyk17b9h9hfmgu8ebb8ecagugugugugugugugugugu8z8zgugugudup8ivimi1jcgug7k0k7bwfbj1enmyk7k0i0k0inh6gajchxqniehrgt99ca99gufpgufpguefgufo9ufbgi7q7qfs89oxgiftgugub1e0aigieqn0faeqe4a7aka7gud69t8787ejejfofofpfpfpfpfpfpeffofo7q7q7q7qgiftftftftftgigigigieqeqguguivivivivi1k7k0k0jcgi"
  };
  var WIDX = null, WROWS = {};
  function roughW(s, o) {
    if (!WIDX) { WIDX = {}; for (var i = 0; i < WT.chars.length; i++) WIDX[WT.chars.charAt(i)] = i; }
    var key = (/Fraunces/.test(o.fam || '') ? 'F' : 'S') + (o.it ? '400i' : String(Math.min(600, Math.max(300, Math.ceil((o.w || 400) / 100) * 100))));
    var row = WROWS[key];
    if (!row) { row = WROWS[key] = []; for (var k = 0; k < WT[key].length; k += 2) row.push(parseInt(WT[key].substr(k, 2), 36) / 1000); }
    var w = 0;
    String(s).split('').forEach(function (ch) { var j = WIDX[ch]; w += j === undefined ? 1 : row[j]; });
    return w * o.size;
  }
  function defaultMeasure(s, o) {
    try {
      if (!canvasCtx && root.document && root.document.createElement) {
        var cv = root.document.createElement('canvas');
        canvasCtx = cv.getContext ? cv.getContext('2d') : null;
      }
      if (canvasCtx) {
        canvasCtx.font = (o.it ? 'italic ' : '') + o.w + ' ' + o.size + 'px ' + o.fam;
        var m = canvasCtx.measureText(String(s));
        if (m && m.width > 0) return m.width;
      }
    } catch (e) { /* fall through */ }
    return roughW(s, o);
  }
  var measure = defaultMeasure;
  function st(o) { return { fam: o.fam || SANS, w: o.w || 400, it: !!o.it, size: o.size || 16, ls: o.ls || 0, fill: o.fill || C.ink, anchor: o.anchor || 'start' }; }
  /* A reader's date rides after its words (panel 5, 2026-10-15: "Planted May 21"): the words carry the
     date as \u0001May 21\u0002, drawn a size smaller in gray at the normal weight, on the same baseline.
     Two dates merged into one label keep each date with its own words ("Planted May 2 · Hail May 4"). */
  var DATE_RE = /\u0001([^\u0001\u0002]*)\u0002/;
  function runs(s, o) {
    var out = [], rest = String(s), m;
    while ((m = DATE_RE.exec(rest))) {
      if (m.index) out.push({ s: rest.slice(0, m.index), o: o });
      out.push({ s: ' ' + m[1], o: dateSt(o), date: true });
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) out.push({ s: rest, o: o });
    return out;
  }
  // 17 u after the 21 u words on Staircase's line, 16 u after Roots' 20 u and the 19 u row under the months
  // (and under 16 u, the footnote voices of 2026-10-17, the date keeps its words' size)
  function dateSt(o) { o = st(o || {}); return Object.assign({}, o, { size: o.size >= 21 ? 17 : o.size >= 16 ? 16 : o.size, w: 400, fill: o.size < 16 ? '#8A8F98' : C.mute, it: false, ls: 0 }); }
  function plain(s) { return String(s).replace(/\u0001([^\u0001\u0002]*)\u0002/g, ' $1'); }
  function W(s, o) {
    if (DATE_RE.test(String(s))) return runs(s, st(o || {})).reduce(function (t, r) { return t + W(r.s, r.o); }, 0);
    o = st(o || {});
    var n = String(s).length;
    return measure(s, o) + o.ls * o.size * Math.max(0, n - 1);
  }
  function T(x, y, s, o) {
    if (DATE_RE.test(String(s))) {
      var rr = runs(s, st(o || {}));
      // the first piece of words opens the line; each date is a tspan, and the words after it go back to the line's own style
      return T(x, y, rr[0].date ? '' : rr[0].s, o).replace('</text>', rr.slice(rr[0].date ? 0 : 1).map(function (r) {
        return r.date ? '<tspan font-size="' + n2(r.o.size) + '" font-weight="' + r.o.w + '" fill="' + r.o.fill + '">' + esc(r.s) + '</tspan>' : esc(r.s);
      }).join('') + '</text>');
    }
    o = st(o || {});
    var ls = o.ls ? ' letter-spacing="' + n2(o.ls * o.size) + '"' : '';
    var dx = o.ls ? (o.anchor === 'middle' ? o.ls * o.size / 2 : o.anchor === 'end' ? o.ls * o.size : 0) : 0;
    return '<text x="' + n2(x + dx) + '" y="' + n2(y) + '" font-family="' + esc(o.fam) + '" font-weight="' + o.w + '" font-style="' + (o.it ? 'italic' : 'normal') +
      '" font-size="' + n2(o.size) + '" fill="' + o.fill + '" text-anchor="' + o.anchor + '"' + ls + ' style="font-variant-numeric:lining-nums">' + esc(s) + '</text>';
  }
  /* How far the ink of s reaches above and below its baseline, in ems. The fonts
     measure 0.75 at most for capitals, digits and tall letters, 0.95 for an
     accented capital, 0.25 for g, j, p, q and y; these round each one up. */
  function asc(s) { return /[À-ÖØ-Þ]/.test(s) ? 0.97 : /[A-Z0-9bdfhijklt'"°“”‘’!?#$%&()\/[\]{}|@]/.test(s) ? 0.77 : 0.6; }
  function desc(s) { return /[gjpqyQ()[\]{}|@$]/.test(s) ? 0.27 : /[,;]/.test(s) ? 0.21 : 0.04; }
  // the ink box of a line of text (the width from the font, the height from its letters)
  function box(x, y, s, o) {
    s = String(s);
    var w = W(s, o), a = (o && o.anchor) || 'start', rr = runs(s, st(o || {}));
    var up = Math.max.apply(null, rr.map(function (r) { return r.s.trim() ? asc(r.s) * r.o.size : 0; }));
    var dn = Math.max.apply(null, rr.map(function (r) { return r.s.trim() ? desc(r.s) * r.o.size : 0; }));
    return { x: a === 'start' ? x : a === 'end' ? x - w : x - w / 2, y: y - up, w: w, h: up + dn };
  }
  function hit(a, b, p) { p = p || 0; return a.x < b.x + b.w + p && b.x < a.x + a.w + p && a.y < b.y + b.h + p && b.y < a.y + a.h + p; }
  function line(x1, y1, x2, y2, stroke, sw, extra) {
    return '<line x1="' + n2(x1) + '" y1="' + n2(y1) + '" x2="' + n2(x2) + '" y2="' + n2(y2) + '" stroke="' + (stroke || C.ink) + '" stroke-width="' + n2(sw || 0.75 * PT) + '"' + (extra || '') + '/>';
  }
  // the largest size (down to min) at which s fits in maxW
  function fit(s, o, maxW, min) {
    var size = o.size;
    while (size > min && W(s, Object.assign({}, o, { size: size })) > maxW) size -= 1;
    return size;
  }

  // ---------- room on the sheet: everything drawn, so each label finds a clear spot ----------
  /* Items: {b: box} or {s: [x1, y1, x2, y2], sw}, with an owner (a label, its
     leader and its mark share one and may touch) and a kind:
       text   words           mark  a dot, ring, bar, pile, the QR, the verdict block
       data   the year's lines (a leader may leave one where it starts, never cut one)
       usual  the usual year's dashed line: words keep off it, a leader may cross it
       lead   leaders, a date's drop line, ticks, brackets     axis  axis and ground lines
       soft   light grid lines: a label keeps off them when it can */
  var CELL = 50;
  function segRect(s, b, p) {
    var x1 = s[0], y1 = s[1], dx = s[2] - x1, dy = s[3] - y1, t0 = 0, t1 = 1;
    var e = [[-dx, x1 - (b.x - p)], [dx, b.x + b.w + p - x1], [-dy, y1 - (b.y - p)], [dy, b.y + b.h + p - y1]];
    for (var i = 0; i < 4; i++) {
      var pp = e[i][0], q = e[i][1];
      if (pp === 0) { if (q < 0) return false; continue; }
      var r = q / pp;
      if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
  }
  function segCross(a, b) {
    var o = function (px, py, qx, qy, rx, ry) { return (qx - px) * (ry - py) - (qy - py) * (rx - px); };
    var d1 = o(b[0], b[1], b[2], b[3], a[0], a[1]), d2 = o(b[0], b[1], b[2], b[3], a[2], a[3]);
    var d3 = o(a[0], a[1], a[2], a[3], b[0], b[1]), d4 = o(a[0], a[1], a[2], a[3], b[2], b[3]);
    if (Math.abs(d1) < 1e-6 && Math.abs(d2) < 1e-6) return false;
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  // the part of a leader farther than r from where it starts
  function awayFrom(s, r) {
    var L = Math.hypot(s[2] - s[0], s[3] - s[1]);
    if (L <= r) return null;
    var t = r / L;
    return [s[0] + (s[2] - s[0]) * t, s[1] + (s[3] - s[1]) * t, s[2], s[3]];
  }
  function Room() { this.cells = {}; this.items = []; this.mark = 0; }
  Room.prototype.add = function (it) {
    if (it.s) { var s = it.s, p = (it.sw || 1) / 2; it.b = { x: Math.min(s[0], s[2]) - p, y: Math.min(s[1], s[3]) - p, w: Math.abs(s[2] - s[0]) + 2 * p, h: Math.abs(s[3] - s[1]) + 2 * p }; }
    it.seen = 0; this.items.push(it);
    var b = it.b;
    for (var cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++)
      for (var cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++) { var k = cx + ',' + cy; (this.cells[k] || (this.cells[k] = [])).push(it); }
    return it;
  };
  Room.prototype.text = function (b, own) { return this.add({ b: b, own: own, k: 'text' }); };
  Room.prototype.seg = function (x1, y1, x2, y2, sw, own, k) { return this.add({ s: [x1, y1, x2, y2], sw: sw, own: own, k: k }); };
  Room.prototype.each = function (b, pad, fn) {
    var m = ++this.mark;
    for (var cx = Math.floor((b.x - pad) / CELL); cx <= Math.floor((b.x + b.w + pad) / CELL); cx++)
      for (var cy = Math.floor((b.y - pad) / CELL); cy <= Math.floor((b.y + b.h + pad) / CELL); cy++) {
        var list = this.cells[cx + ',' + cy];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) { var it = list[i]; if (it.seen === m || it.dead) continue; it.seen = m; if (fn(it)) return true; }
      }
    return false;
  };
  /* Is box b clear of everything another owner drew? Words keep 6 units from
     words, 3 from lines and marks; strict also keeps off the light grid. */
  Room.prototype.free = function (b, own, strict) {
    return !this.each(b, 10, function (it) {
      if (it.own === own || (it.k === 'soft' && !strict)) return false;
      if (it.s) return segRect(it.s, b, (it.k === 'soft' ? 1 : 3) + (it.sw || 1) / 2);
      return hit(it.b, b, it.k === 'text' ? 6 : 3);
    });
  };
  /* Is leader s clear? It may not cross another leader, a date's drop line or an
     axis, touch words or a mark, or cut the data more than r from its start. */
  Room.prototype.clear = function (s, own, r) {
    var bb = { x: Math.min(s[0], s[2]), y: Math.min(s[1], s[3]), w: Math.abs(s[2] - s[0]), h: Math.abs(s[3] - s[1]) };
    var far = awayFrom(s, r || 0);
    return !this.each(bb, 8, function (it) {
      if (it.own === own || it.k === 'soft' || it.k === 'usual') return false;
      if (it.k === 'data') return far ? (it.s ? segCross(far, it.s) : segRect(far, it.b, 1)) : false;
      if (it.s) return segCross(s, it.s);
      // a dot on the very spot the leader starts from (a date on the same day) is not in its way
      if (r && it.k === 'mark' && Math.hypot(it.b.x + it.b.w / 2 - s[0], it.b.y + it.b.h / 2 - s[1]) < 9) return far ? segRect(far, it.b, 0) : false;
      return segRect(s, it.b, it.k === 'text' ? 3 : 1.5);
    });
  };

  /* The reader's dates in a row of words (both styles). items: [{xs: the ticks
     its words must sit over, w, own}], rows: baselines, best first. A label sits
     under (or over) its own tick, slid along the row as far as it must, on the
     first row with room; the search tries every combination and keeps the one
     that moves the words least. ok(item, box, row) says whether the room is
     clear; pair(a, ba, ra, b, bb, rb) whether two placed labels get along.
     Returns [{x (left), row}] or null when no combination fits. */
  function rowSolve(items, rows, ok, pair, h, bounds) {
    var opts = items.map(function (it) {
      var lo = Math.max(62, Math.max.apply(null, it.xs) + 3 - it.w), hi = Math.min(1738 - it.w, Math.min.apply(null, it.xs) - 3);
      var mid = (Math.min.apply(null, it.xs) + Math.max.apply(null, it.xs)) / 2 - it.w / 2;
      // best: centered under its tick, kept inside the style's own margins when it can be (bounds)
      var pL = Math.max(lo, bounds[0]), pR = Math.min(hi, bounds[1] - it.w);
      var x0 = Math.min.apply(null, it.xs), x1 = Math.max.apply(null, it.xs);
      // at a margin: start just left of the tick (or end just right of it), as the print always has
      var edge = mid < bounds[0] ? x0 - 12 : mid + it.w > bounds[1] ? x1 + 12 - it.w : mid;
      var pref = pL <= pR ? Math.max(pL, Math.min(pR, mid)) : Math.max(lo, Math.min(hi, edge)), xsCand = [];
      if (hi < lo) return [];
      for (var d = 0; d <= hi - lo + 4; d += 4) { [pref - d, pref + d].forEach(function (x) { if (x >= lo - 1e-9 && x <= hi + 1e-9 && xsCand.indexOf(x) < 0) xsCand.push(x); }); }
      [lo, hi].forEach(function (x) { if (xsCand.indexOf(x) < 0) xsCand.push(x); });
      var out = [];
      rows.forEach(function (y, r) {
        xsCand.forEach(function (x) {
          var b = { x: x, y: y - h[0], w: it.w, h: h[0] + h[1] };
          if (ok(it, b, r)) out.push({ x: x, row: r, b: b, cost: Math.abs(x - pref) + r * 60 });
        });
      });
      return out.sort(function (a, b) { return a.cost - b.cost; });
    });
    var best = null, bestCost = Infinity, pick = [], nodes = 0;
    (function dfs(k, cost) {
      if (cost >= bestCost || nodes > 40000) return;
      if (k === items.length) { best = pick.slice(); bestCost = cost; return; }
      for (var i = 0; i < opts[k].length; i++) {
        var o = opts[k][i];
        nodes++;
        if (cost + o.cost >= bestCost) break;
        var good = true;
        for (var j = 0; j < k && good; j++) good = pair(items[j], pick[j].b, pick[j].row, items[k], o.b, o.row);
        if (!good) continue;
        pick.push(o); dfs(k + 1, cost + o.cost); pick.pop();
      }
    })(0, 0);
    return best;
  }
  /* Dates too close to share a row are drawn as one label: their words in date
     order, joined by a middle dot, over both ticks. Never dropped. */
  function placeDates(marks, rows, measureW, ok, pair, h, bounds) {
    var items = marks.filter(function (m) { return m.label; }).map(function (m) { return { xs: [m.x], label: m.label, ids: [m.k] }; });
    for (;;) {
      items.forEach(function (it) { it.w = measureW(it.label); });
      var sol = items.length ? rowSolve(items, rows, ok, pair, h, bounds) : [];
      if (sol) return items.map(function (it, k) { return { it: it, x: sol[k].x, row: sol[k].row, y: rows[sol[k].row] }; });
      if (items.length < 2) { last_forced = true; return items.map(function (it) { return { it: it, x: Math.max(62, Math.min(1738 - it.w, it.xs[0] - it.w / 2)), row: 0, y: rows[0], forced: true }; }); }
      var bi = 0, bd = Infinity;
      for (var i = 0; i + 1 < items.length; i++) { var d = Math.min.apply(null, items[i + 1].xs) - Math.max.apply(null, items[i].xs); if (d < bd) { bd = d; bi = i; } }
      var A = items[bi], B = items[bi + 1];
      items.splice(bi, 2, { xs: A.xs.concat(B.xs), label: A.label + ' · ' + B.label, ids: A.ids.concat(B.ids) });
    }
  }

  // ---------- the year, in the shape both styles draw ----------
  function model(I) {
    var days = I.days || [], D = I.D, n = days.length, year = +I.year;
    var N = Math.max(n, I.axisLen || 0, 1);
    var P = days.map(function (x) { return x.v === null || x.v === undefined || x.flag === 'S' ? null : x.v; });
    var snowMissing = 0, snowTot = 0;
    // a day with no precipitation report is a gap already (the foot line says so): it doesn't also count against the snow record (2026-10-14, panel 3 D2)
    days.forEach(function (x) { if (x.v === null || x.v === undefined) return; if (x.s === null || x.s === undefined) snowMissing++; else snowTot += x.s; });
    var snowState = snowMissing <= 10 ? (snowTot >= 0.1 ? 'full' : 'none') : 'unknown';
    if (n === 0) snowState = 'unknown';
    var full = snowState === 'full';
    /* A station that doesn't report snowfall (or reports it with holes) draws no snow at all: one plain line at
       the foot says why, so no one looks for the snow (panel 4, 2026-10-14). Its gauge still melts what falls. */
    var snowNote = '';
    if (snowState === 'unknown' && n > 0) {
      var someSnow = days.some(function (x) { return x.v !== null && x.v !== undefined && x.s !== null && x.s !== undefined; });
      snowNote = tr(someSnow ? 'This station’s snowfall record has holes, so no snow is drawn; melted snow is counted in the total'
        : 'This station doesn’t report snowfall; melted snow is counted in the total');
    }
    var cum = [], c = 0;
    P.forEach(function (p) { if (p !== null) c += p; cum.push(p === null ? null : c); });
    var ov = I.ov && I.ov.daily ? I.ov : null;
    var ncum = [], nc = 0;
    if (ov) for (var i = 0; i < n; i++) { nc += ov.daily[i] || 0; ncum.push(nc); }
    var starts = [];
    for (var m = 0; m < 12; m++) starts.push(doyOf(year, year + '-' + String(m + 1).padStart(2, '0') + '-01'));
    var ends = starts.slice(1).concat([isLeap(year) ? 366 : 365]);
    var monthHas = Array(12).fill(false);
    days.forEach(function (x, k) { if (P[k] !== null) monthHas[x.m] = true; });
    var mN = Array(12).fill(0);
    if (ov) days.forEach(function (x, k) { mN[x.m] += ov.daily[k] || 0; });
    var total = D.total, Ts = rainNum(total, 'tot');
    var liquid = tr({ full: 'rain and melted snow', none: 'rain', unknown: 'precipitation' }[snowState]);
    // the red mark is the biggest rain: with a whole snow record, picked from rain days only (Sig, 2026-10-13)
    var M = full && D.maxRain ? D.maxRain : D.max;
    var wi = M && M.v > 0 && M.doy >= 0 ? M.doy : -1;
    var wet = wi >= 0 ? { p: M.v, date: M.date } : null;
    var wetLabel = tr(full ? 'Biggest rain' : wi >= 0 && days[wi].s > 0 ? 'Wettest day' : 'Biggest rain');
    // no verdict on a usual year under an inch: a percent of almost nothing says nothing
    var pct = ov && ov.total >= 1 ? Math.round((total - ov.total) / ov.total * 100) : null;
    var soFar = I.preview ? (LOC.fr ? ' jusqu’ici' : ' so far') : '';
    var verdict = pct === null ? null : (Math.abs(pct) <= 3 ? tr('About a usual year')
      : pct > 100 ? num(1 + pct / 100, 1) + (LOC.fr ? ' fois une année normale' : ' times a usual year')
      : LOC.fr ? pctText(Math.abs(pct)) + (pct < 0 ? ' de moins' : ' de plus') + ' qu’une année normale'
      : Math.abs(pct) + '% ' + (pct < 0 ? 'less' : 'more') + ' than a usual year') + soFar;
    // whether a dry stretch is long enough to mark is the engine's call (RainPrint.showDry), never this file's
    var dry = I.showDry && D.dryMax && D.dryMax.startDoy >= 0 ? { s: D.dryMax.startDoy, e: D.dryMax.endDoy, len: D.dryMax.len } : null;
    if (dry) dry.range = fmtRange(days[dry.s].date, days[dry.e].date);
    var markers = (I.markers || []).filter(function (mk) { return mk.doy >= 0 && mk.doy < n; }).slice(0, MAX_MARKS)
      .map(function (mk) {
        // the words, then the day itself; a day with no words already prints as its date
        var lb = String(mk.label || '').replace(/[\u0001\u0002]/g, ''), dt = days[mk.doy] && days[mk.doy].date, f = dt ? fmtDate(dt) : '';
        return { i: mk.doy, label: lb && f && lb !== f ? lb + '\u0001' + f + '\u0002' : lb, words: lb, date: f };
      }).sort(function (a, b) { return a.i - b.i; });
    var maxP = Math.max.apply(null, [0.01].concat(P.filter(function (p) { return p !== null; })));
    var maxSnow = Math.max.apply(null, [0].concat(days.map(function (x) { return x.s > 0 ? x.s : 0; })));
    return {
      year: year, N: N, n: n, days: days, P: P, cum: cum, ncum: ncum, cmp: !!ov, ov: ov, normalRec: ov ? ov.total : null,
      starts: starts, ends: ends, monthHas: monthHas, month: D.month || Array(12).fill(0), mN: mN,
      total: total, T: Ts, TU: Ts + ' ' + rU(), liquid: liquid, full: full, snowState: snowState, snowNote: snowNote, snowTot: Math.round(snowTot * 10) / 10, snowRaw: snowTot,
      wi: wi, wet: wet, wetLabel: wetLabel, // the day in gray after the amount, like every other date on the print (2026-10-15)
      wetText: wet ? colon(wetLabel) + rainAmt(wet.p, 'day') + '\u0001' + fmtDate(wet.date) + '\u0002' : null,
      daysText: colon(tr(snowState === 'none' ? 'Days with rain' : 'Days with rain or snow')) + D.wet,
      // metric: the cm come from the days' own sum, not from the inches rounded to a tenth
      snowText: full ? colon(tr('Snow')) + (LOC.mm ? snowAmt(snowTot) : (Math.round(snowTot * 10) / 10).toFixed(1) + ' in') : null,
      snowKey: full ? tr('light blue: snow') : null,
      verdict: verdict, dry: dry, markers: markers, maxP: maxP, maxSnow: maxSnow,
      name: String(I.name || '').trim(), dedication: String(I.dedication || '').trim(), place: String(I.place || ''),
      showN: !!(ov && I.showNormals), ovNote: I.ovNote || '', preview: I.preview || null, soFar: soFar,
      gauge: String(I.gauge || '').trim(), gaps: P.some(function (p) { return p === null; }),
      // days the station sent nothing at all (an S day rolled into a later total is not one)
      missing: days.filter(function (x) { return x.v === null || x.v === undefined; }).length,
      // days the station sent nothing: the usual year leaves them out too, so its number is not NOAA's whole year
      unrecorded: days.some(function (x) { return x.v === null || x.v === undefined; })
    };
  }

  // ---------- records: which ones draw as a point, which as a line of text ----------
  /* A remarkable day prints its date after its words, the way a reader's date does (Sig, 2026-10-15: "Biggest snow:
     8.0 in Feb 3", the date in gray). A week or other stretch prints its range ("Wettest week: 3.10 in May 3 to 9");
     a whole month or year is its own date and gets none. A tie note stays after the date: the date is the day drawn.
     pt.label is the words alone (what the layer said); pt.text is what is drawn and measured. */
  var TIE_RE = / \((?:also [^)]*|on \d+ days|aussi [^)]*|sur \d+ jours)\)$/;
  function recDate(E, r, sp) {
    if (sp) {
      var f = String(sp.from), t = String(sp.to), y = +f.slice(0, 4), m = +f.slice(5, 7);
      if (f.slice(8) === '01' && t.slice(0, 7) === f.slice(0, 7) && +t.slice(8) === new Date(Date.UTC(y, m, 0)).getUTCDate()) return '';
      return f === t ? fmtDate(f) : fmtRange(f, t);
    }
    return fmtDate(r.date);
  }
  function dated(words, d) {
    var m = TIE_RE.exec(words), head = m ? words.slice(0, m.index) : words;
    return d ? head + '\u0001' + d + '\u0002' + (m ? m[0] : '') : words;
  }
  // a label with one date, as two lines: the words, then the date (and any tie note) under them
  var TWO_DY = 19;
  function splitDate(s) {
    s = String(s);
    var m = DATE_RE.exec(s);
    if (!m || DATE_RE.test(s.slice(m.index + m[0].length))) return null;
    return [s.slice(0, m.index), plain(s.slice(m.index)).trim()];
  }
  function twoBox(x, y, two, o, a) {
    var b1 = box(x, y, two[0], Object.assign({}, o, { anchor: a })), b2 = box(x, y + TWO_DY, two[1], Object.assign(dateSt(o), { anchor: a }));
    var x0 = Math.min(b1.x, b2.x), y0 = Math.min(b1.y, b2.y);
    return { x: x0, y: y0, w: Math.max(b1.x + b1.w, b2.x + b2.w) - x0, h: Math.max(b1.y + b1.h, b2.y + b2.h) - y0 };
  }
  function recordPoints(E, recs) {
    var pts = [], lines = [];
    (recs || []).forEach(function (r) {
      if (!r || !r.label) return;
      var sp = r.span && r.span.from && r.span.to ? r.span : null;
      if (sp && sp.from.slice(5) === '01-01' && sp.to.slice(5) === '12-31') { lines.push(r.label); return; }
      var a = doyOf(E.year, sp ? sp.from : r.date), b = sp ? doyOf(E.year, sp.to) : a;
      if (a < 0 || a >= E.n) return;
      if (b < a || b >= E.n) { b = a; sp = sp ? { from: sp.from, to: sp.from } : null; }
      var words = String(r.label).replace(/[\u0001\u0002]/g, '');
      pts.push({ i: Math.round((a + b) / 2), a: a, b: b, label: words, text: dated(words, recDate(E, r, sp)), span: !!r.span });
    });
    pts.sort(function (p, q) { return p.i - q.i; });
    return { pts: mergeSameDay(pts), lines: lines };
  }

  /* Two records on one day get one label (2026-10-13: "Biggest snow: 8.0 in"
     and "First snow: 8.0 in" printed twice on the same day). Same amount:
     "First snow and biggest snow: 8.0 in Nov 20". Different amounts: both,
     joined, the day's date once at the end ("Coldest: -20°F; biggest snow: 9.0 in Jan 5"), or after
     each part when a tie note sits in the middle ("Coldest: -20°F Jan 5 (also Jan 21); biggest snow: 9.0 in Jan 5"). */
  function mergeSameDay(pts) {
    var out = [];
    pts.forEach(function (p) {
      var prev = out.length ? out[out.length - 1] : null;
      if (prev && !p.span && !prev.span && prev.a === p.a) {
        var A = /^(.*?) ?: (.*)$/.exec(prev.label), B = /^(.*?) ?: (.*)$/.exec(p.label);
        var first = function (x) { return /^(First|Last|Premi|Derni)/.test(x[1]) ? 0 : 1; };
        var lc = function (s) { return s.charAt(0).toLowerCase() + s.slice(1); };
        var d = DATE_RE.exec(p.text);
        if (A && B && A[2] === B[2]) {
          var pair = first(A) <= first(B) ? [A, B] : [B, A];
          prev.label = colon(pair[0][1] + (LOC.fr ? ' et ' : ' and ') + lc(pair[1][1])) + A[2];
          prev.text = dated(prev.label, d ? d[1] : '');
        } else {
          // one date at the end; a tie note before the last part keeps each date beside its own words, so no date reads as another's
          prev.parts = (prev.parts || [{ label: prev.label, text: prev.text }]).concat([{ label: p.label, text: p.text }]);
          prev.label = prev.parts.map(function (q, n) { return n ? lc(q.label) : q.label; }).join('; ');
          prev.text = prev.parts.slice(0, -1).some(function (q) { return TIE_RE.test(q.label); })
            ? prev.parts.map(function (q, n) { return n ? lc(q.text) : q.text; }).join('; ') : dated(prev.label, d ? d[1] : '');
        }
        return;
      }
      out.push(p);
    });
    return out;
  }

  // ---------- the maker's mark: QR, square to the page, serial under it ----------
  var snap = function (v) { return Math.round(v * 3) / 3; };   // whole 300 dpi pixels
  /* One QR module, in 300 dpi pixels. The short link is 25 modules: 10 px each
     makes the mark 250 px, about 0.85 in (Sig's size). A long ?d= code falls back
     to the old rule. The quiet zone is 4 modules, as the QR standard asks. */
  function qrCell(n) { return n <= 29 ? 10 : Math.max(2, Math.min(7, Math.floor(255 / (n + 6)))); }
  function qrMark(Q, right, bottom) {
    if (!Q || !Q.matrix || !Q.matrix.length) return '';
    var m = Q.matrix, n = m.length;
    var cell = qrCell(n) / 3;
    var mx1 = snap(right), my1 = snap(bottom - 17);
    var mx0 = snap(mx1 - n * cell), my0 = snap(my1 - n * cell), quiet = 4 * cell;
    var d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n;) {
      if (!m[r][c]) { c++; continue; }
      var e = c; while (e < n && m[r][e]) e++;
      // absolute, snapped edges, so neighbouring rows share the exact same number and no pale seam shows (cell is fractional; 2026-10-14, panel 3 D7)
      var x0 = n2(mx0 + c * cell), x1 = n2(mx0 + e * cell), y0 = n2(my0 + r * cell), y1 = n2(my0 + (r + 1) * cell);
      d += 'M' + x0 + ',' + y0 + 'H' + x1 + 'V' + y1 + 'H' + x0 + 'z';
      c = e;
    }
    var s = '<g data-rp="qr"><g aria-hidden="true"><rect x="' + n2(mx0 - quiet) + '" y="' + n2(my0 - quiet) + '" width="' + n2(n * cell + 2 * quiet) + '" height="' + n2(n * cell + 2 * quiet) + '" fill="#FFFFFF"/>' +
      '<path d="' + d + '" fill="' + QR_INK + '" shape-rendering="crispEdges"/></g>';
    if (Q.serial) s += '<text x="' + n2((mx0 + mx1) / 2) + '" y="' + n2(bottom) + '" font-family="' + esc(SANS) + '" font-size="11.5" fill="' + SERIAL_INK + '" text-anchor="middle" letter-spacing="0.3" style="font-variant-numeric:tabular-nums lining-nums">' + esc(Q.serial) + '</text>';
    return s + '</g>';
  }

  // ---------- the buyer's logo (2026-10-14, Sig: "incorporated into the print tastefully") ----------
  /* Beside the name block, about its height (roughly 0.9 to 1.05 in): R1 left
     of the place, year and name at the foot, R2 left of the name and place at
     the top. The words move right to make room and shrink as they always do;
     the logo itself is never over LOGO_MAX either way (art units, 100 to the
     inch), keeps its shape, and is a mark the labels keep clear of. Only a
     PNG data URL is drawn (the engine reads the stored PNG into one, so a
     canvas making the print file is never tainted and no address is printed). */
  var LOGO_MAX = { r1: { w: 260, h: 104 }, r2: { w: 240, h: 92 } }, LOGO_GAP = 30;
  var LOGO_HREF = /^data:image\/png;base64,[A-Za-z0-9+\/]+=*$/;
  function logoSize(style, aspect) {
    var M = LOGO_MAX[style === 'r2' ? 'r2' : 'r1'], a = aspect > 0 && isFinite(aspect) ? aspect : 1;
    var h = M.h, w = h * a;
    if (w > M.w) { w = M.w; h = w / a; }
    return { w: n2(w), h: n2(h) };
  }
  function logoOf(I, style) {
    var L = I.logo;
    if (!L || !LOGO_HREF.test(String(L.href || '')) || !(L.w > 0 && L.h > 0)) return null;
    var sz = logoSize(style, L.w / L.h);
    return { href: L.href, w: sz.w, h: sz.h, x: 0, y: 0 };
  }
  function logoMark(lg) {
    return G0('logo') + '<image href="' + lg.href + '" x="' + n2(lg.x) + '" y="' + n2(lg.y) + '" width="' + n2(lg.w) + '" height="' + n2(lg.h) +
      '" preserveAspectRatio="xMidYMid meet"/>' + G1;
  }

  // ---------- a preview of this year: a band across the art, and the watermark ----------
  // across the chart only (2026-10-13): edge to edge it hid the scale's numbers
  function previewBand(E, b) {
    var t = (LOC.fr ? 'APERÇU JUSQU’AU ' : 'PREVIEW THROUGH ') + fmtDate(E.preview.last).toUpperCase(), y = b.y, cx = (b.x0 + b.x1) / 2;
    return '<g data-rp="band" aria-hidden="true"><rect x="' + n2(b.x0) + '" y="' + (y - 34) + '" width="' + n2(b.x1 - b.x0) + '" height="68" fill="' + C.ink + '" opacity="0.88"/>' +
      T(cx, y - 4, t, { w: 500, size: 24, ls: 0.12, fill: '#FFFFFF', anchor: 'middle' }) +
      T(cx, y + 22, (LOC.fr ? 'Le tirage final montre toute l’année, du 1er janvier au 31 décembre ' : 'Your print will show the full year, Jan 1 to Dec 31, ') + E.year, { size: 17, fill: '#FFFFFF', anchor: 'middle' }) + '</g>';
  }
  function watermark() {
    var row = '', out = '', i;
    for (i = 0; i < 6; i++) row += tr('PREVIEW') + '  ·  AGSIST.COM/RAIN-PRINT  ·  ';
    for (i = -6; i < 14; i++) out += '<text x="' + (-W0) + '" y="' + (i * 140) + '" font-family="' + esc(SANS) + '" font-size="38" font-weight="500" fill="' + C.ink + '" letter-spacing="4">' + row + '</text>';
    return '<g data-rp="wm" opacity="0.13" transform="rotate(-24 ' + (W0 / 2) + ' ' + (H0 / 2) + ')" aria-hidden="true">' + out + '</g>';
  }

  function open(I, E) {
    var b = I.bleed || 0;
    var size = I.px ? ' width="' + I.px[0] + '" height="' + I.px[1] + '"' : '';
    var title = E.place + ', ' + E.year + ', ' + (LOC.fr ? 'Rain Print' + (E.preview ? ', aperçu jusqu’au ' + fmtDate(E.preview.last) : '') : 'rain print' + (E.preview ? ', preview through ' + fmtDate(E.preview.last) : ''));
    var desc = E.TU + (LOC.fr ? ' de ' : ' of ') + E.liquid + (E.snowText ? '. ' + E.snowText : '') + '. ' + E.daysText + (E.verdict ? '. ' + E.verdict : '') + '.';
    var id = I.idPrefix || 'rp';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-b) + ' ' + (-b) + ' ' + (W0 + 2 * b) + ' ' + (H0 + 2 * b) + '"' + size +
      ' font-family="' + esc(SANS) + '" role="img" aria-labelledby="' + id + 'T" aria-describedby="' + id + 'D">' +
      (I.fontCss ? '<style>' + I.fontCss + '</style>' : '') +
      '<title id="' + id + 'T">' + esc(title) + '</title><desc id="' + id + 'D">' + esc(desc) + '</desc>' +
      '<rect x="' + (-b) + '" y="' + (-b) + '" width="' + (W0 + 2 * b) + '" height="' + (H0 + 2 * b) + '" fill="#FFFFFF"/>';
  }
  /* The months still to come on the gift card: a pale wash from the last
     reported day to the end of the year, and preview.later in it (two lines when
     one won't fit, left off when the strip is too narrow for either), at 28
     units so it reads at the card's size. Kept clear of the PREVIEW band. r: the strip {x0, x1, y0, y1}. */
  function laterWash(E, r, band) {
    var words = String(E.preview.later || '').trim(), w = r.x1 - r.x0;
    if (!words || w < 24) return '';
    var o = '<g data-rp="later" aria-hidden="true"><rect x="' + n2(r.x0) + '" y="' + n2(r.y0) + '" width="' + n2(w) + '" height="' + n2(r.y1 - r.y0) + '" fill="' + C.guide + '" opacity="0.42"/>';
    var ls = { w: 500, size: 28, fill: C.mute, anchor: 'middle' }, lines = [words];
    if (W(words, ls) > w - 28) {
      var sp = words.split(' '), best = null;
      for (var i = 1; i < sp.length; i++) {
        var a = sp.slice(0, i).join(' '), b = sp.slice(i).join(' '), m = Math.max(W(a, ls), W(b, ls));
        if (!best || m < best.m) best = { m: m, l: [a, b] };
      }
      lines = best && best.m <= w - 28 ? best.l : [];
    }
    if (lines.length) {
      var hgt = lines.length * 36, cx = (r.x0 + r.x1) / 2, y = (r.y0 + r.y1) / 2 - hgt / 2 + 26;
      var clash = function (yy) { return band && band.x1 > r.x0 && band.x0 < r.x1 && yy - 20 < band.y + 40 && yy + hgt > band.y - 40; };
      if (clash(y)) y = band.y - r.y0 > r.y1 - band.y ? r.y0 + 50 : r.y1 - hgt + 16;
      lines.forEach(function (t, k) { o += T(cx, y + k * 36, t, ls); });
    }
    return o + '</g>';
  }
  // bandY: where the preview band goes (bandAt picks a height that hides no label)
  function close(I, E, o, bandY) {
    if (E.preview && E.preview.later && E.laterBox) o.push(laterWash(E, E.laterBox, bandY));
    if (E.preview) o.push(previewBand(E, bandY));
    if (I.watermark) o.push(watermark());
    o.push('</svg>');
    return o.join('');
  }

  /* The one small line at the foot of the sheet, both styles: the gauge by name
     and distance, which mark is snow, what a gap is, what a usual year is, a
     station with no snowfall record, and whatever a style hands it (extra).
     15 u, down to 12 to stay one line; only past that does it take a second
     line above (never under 12 u). Inside the 0.6 in safe margin (last
     baseline 1132), left of the QR. */
  var FOOT_Y = 1132, FOOT_GAP = 22, GAP_QUIET = 3;
  function smallLine(E, x, maxW, extra) {
    var parts = [];
    if (E.gauge) parts.push(E.gauge);
    // which mark is snow and which is rain, in plain words (Sig, 2026-10-13: tell them apart at a glance)
    if (E.full) parts.push(tr(E.style2 ? 'Light blue above the ground is snow, dark bars below it are rain' : 'Dark blue steps are rain, light blue steps are snow'));
    if (E.snowNote) parts.push(E.snowNote);
    /* Gaps, said short (Sig, 2026-10-15: the full sentence was too long for the foot line; the page's station line
       explains them in full). Three or fewer missing days say nothing on the print; more give the count. */
    if (E.missing > GAP_QUIET) parts.push(LOC.fr ? 'Trous : ' + E.missing + ' jours sans relevé' : 'Gaps: ' + E.missing + ' days with no report');
    (extra || []).forEach(function (t) { if (t) parts.push(t); });
    if (!parts.length) return null;
    var SEP = '  ·  ', st0 = { size: 15, fill: C.mute }, lines = [parts.join(SEP)];
    st0.size = fit(lines[0], st0, maxW, 12);
    if (W(lines[0], st0) > maxW) {
      // two lines, split where the longer of the two is shortest
      var best = null;
      for (var k = 1; k < parts.length; k++) {
        var a = parts.slice(0, k).join(SEP), b = parts.slice(k).join(SEP), m = Math.max(W(a, { size: 15 }), W(b, { size: 15 }));
        if (!best || m < best.m) best = { m: m, l: [a, b] };
      }
      if (best) {
        lines = best.l;
        st0.size = Math.min(fit(lines[0], { size: 15 }, maxW, 12), fit(lines[1], { size: 15 }, maxW, 12));
      }
    }
    /* Still too long at 12 u (the 2026-10-17 options add their sources here): packed at 12 u into as many
       lines as it takes, up to three; a part that fits no line is cut at a word, never run off the paper. */
    if (lines.some(function (t) { return W(t, { size: st0.size }) > maxW + 0.5; })) {
      st0.size = 12;
      var pk = [[]];
      parts.forEach(function (t) { var cur = pk[pk.length - 1]; if (!cur.length || W(cur.concat([t]).join(SEP), st0) <= maxW) cur.push(t); else pk.push([t]); });
      if (pk.length > 4) pk = pk.slice(0, 3).concat([pk.slice(3).reduce(function (a, l) { return a.concat(l); }, [])]);
      lines = pk.map(function (l) { var t = l.join(SEP); while (W(t, st0) > maxW && t.indexOf(' ') > 0) t = t.slice(0, t.lastIndexOf(' ')); return t; });
    }
    var ys = lines.map(function (t, k) { return FOOT_Y - (lines.length - 1 - k) * FOOT_GAP; }), svg = '', boxes = [];
    lines.forEach(function (t, k) { svg += T(x, ys[k], t, st0); boxes.push(box(x, ys[k], t, st0)); });
    var u = boxes.reduce(function (A, B) { var x0 = Math.min(A.x, B.x), y0 = Math.min(A.y, B.y); return { x: x0, y: y0, w: Math.max(A.x + A.w, B.x + B.w) - x0, h: Math.max(A.y + A.h, B.y + B.h) - y0 }; });
    return { svg: G0('foot') + svg + G1, box: u, boxes: boxes, lines: lines.length, size: st0.size };
  }

  // ---------- shared by both styles ----------
  // the part of a line of text that sits right of dx (its letters decide how low it reaches there)
  function tailFrom(s, o, dx) {
    s = String(s);
    for (var k = 0; k < s.length; k++) if (W(s.slice(0, k + 1), o) > dx) return s.slice(k);
    return '';
  }
  // where the QR and its serial sit (the same arithmetic as qrMark)
  function qrBox(Q, right, bottom) {
    if (!Q || !Q.matrix || !Q.matrix.length) return null;
    var n = Q.matrix.length, cell = qrCell(n) / 3;
    var mx1 = snap(right), my1 = snap(bottom - 17), mx0 = snap(mx1 - n * cell), my0 = snap(my1 - n * cell), q = 4 * cell;
    return { x: mx0 - q, y: my0 - q, w: n * cell + 2 * q, h: (Q.serial ? bottom + 3 : my1 + q) - (my0 - q) };
  }
  /* Candidate spots for a label near (ax, ay), nearest first: the hand-picked
     ones a style likes, then a widening ring on both sides. */
  function spots(ax, ay, first, dxs) {
    var out = first.map(function (k) { return { x: ax + k[0], y: ay + k[1], a: k[2] }; });
    var dys = [0];
    for (var d = 14; d <= 330; d += 14) dys.push(d, -d);
    dxs.forEach(function (dx) { dys.forEach(function (dy) { out.push({ x: ax + dx, y: ay + dy, a: 'start' }, { x: ax - dx, y: ay + dy, a: 'end' }); }); });
    return out;
  }
  /* The first candidate whose words are clear and whose leader is clear. A spot
     on a light grid line counts as eight places further down the list. */
  function choose(cands, test) {
    var loose = -1;
    for (var i = 0; i < cands.length; i++) {
      if (loose >= 0 && i - loose >= 8) return cands[loose];
      var t = test(cands[i]);
      if (t === 2) return cands[i];
      if (t === 1 && loose < 0) loose = i;
    }
    return loose >= 0 ? cands[loose] : null;
  }
  /* Remarkable days go in one by one (place(k) -> the items it added, or null).
     One that finds no room tries again with a placed neighbour lifted out, and
     keeps that only if the neighbour then finds room too. What still has no
     room is named in skipped (the page lists it under the preview). */
  function placeAll(pts, place, skipped, order) {
    var at = [];
    (order || pts.map(function (r, k) { return k; })).forEach(function (k) { at[k] = place(k, at); });
    var lift = function (k) { at[k].forEach(function (it) { it.dead = true; }); at[k] = null; };
    var keep = function (k, items) { items.forEach(function (it) { it.dead = false; }); at[k] = items; };
    pts.forEach(function (r, k) {
      if (at[k]) return;
      var near = pts.map(function (q, j) { return j; }).filter(function (j) { return at[j]; })
        .sort(function (a, b) { return Math.abs(pts[a].i - r.i) - Math.abs(pts[b].i - r.i); }).slice(0, 4);
      for (var n = 0; n < near.length && !at[k]; n++) {
        var j = near[n], was = at[j];
        lift(j);
        at[k] = place(k, at);
        if (at[k]) { at[j] = place(j, at); if (at[j]) break; lift(k); }
        keep(j, was);   // as it was
      }
    });
    pts.forEach(function (r, k) { if (!at[k]) skipped.push(r.label); });
    return at.map(function (a) { return a ? a.pick : null; });
  }
  // where the preview band goes: the first height that hides no words, mark or leader
  // spare: a strip of empty paper (its middle y) for when the chart is full at every height and the months to come are too narrow
  function bandAt(room, prefer, lo, hi, x0, x1, alt, spare) {
    var ys = prefer.slice();
    for (var y = lo; y <= hi; y += 4) ys.push(y);
    var cost = function (y, a0, a1) {
      var n = 0, bb = { x: a0, y: y - 36, w: a1 - a0, h: 72 };
      room.each(bb, 0, function (it) {
        // words (and the header) weigh most: a band may hide a dot before it hides a word
        if (it.k === 'text' || it.own === 'head') { if (hit(it.b, bb)) n += 10; }
        else if ((it.k === 'mark' && it.own !== 'data') || (it.k === 'lead' && /^(rec|wet)/.test(it.own))) { if (hit(it.b, bb)) n++; }
        return false;
      });
      return n;
    };
    var best = ys[0], bc = Infinity;
    for (var i = 0; i < ys.length; i++) { var c = cost(ys[i], x0, x1); if (c === 0) return { y: ys[i], x0: x0, x1: x1 }; if (c < bc) { bc = c; best = ys[i]; } }
    // a preview with no clear height across the chart: the months still to come, if they are wide enough
    if (alt && alt[1] - alt[0] >= 520) for (var j = 0; j < ys.length; j++) if (cost(ys[j], alt[0], alt[1]) === 0) return { y: ys[j], x0: alt[0], x1: alt[1] };
    if (spare && cost(spare, x0, x1) === 0) return { y: spare, x0: x0, x1: x1 };
    return { y: best, x0: x0, x1: x1 };
  }

  // ======================================================================= the 2026-10-17 options, shared by both styles
  /* Crop stages (input.crop), frost marks and the temperature ribbon (input.temp), every year behind your year
     (input.hist, Staircase). The numbers are worked out before render (components/rain-print-extras.js); this
     file only places and draws them. */
  var X = { ink: '#1F2328', date: '#8A8F98', fact: '#5B616B', grid: '#EEF0F2', usualM: '#A3A8B0', red: '#B23A2E', stone: '#ECE6DE', ahead: '#EAEFF4', thread: '#DDD8D0' };
  var CROP_INK = '#5B616B', GHOST_INK = '#CFCBC4', PLANT_H = 54;
  // the footnote voices: 12 u words, the date after them in gray (Sig's typographer list, 2026-10-17)
  var FACT = { size: 12, w: 400, fill: X.fact }, FACT_D = { size: 12, w: 400, fill: X.date };
  // the dedication in plain italic: no swash or discretionary ligatures, at a text optical size (both styles)
  var PLAIN_IT = "font-variation-settings:'opsz' 12;font-variant-ligatures:no-discretionary-ligatures;font-feature-settings:'swsh' 0,'dlig' 0";
  function dedText(x, y, s, size, fill) {
    return '<text x="' + n2(x) + '" y="' + n2(y) + '" font-family="' + esc(SERIF) + '" font-style="italic" font-weight="400" font-size="' + n2(size) + '" fill="' + fill +
      '" style="' + PLAIN_IT + '">' + esc(s) + '</text>';
  }
  // words, then an optional date in its own voice on the same baseline
  function tv(x, y, s, o, date, dO) {
    var t = T(x, y, s, o);
    if (date) t = t.replace('</text>', '<tspan font-size="' + n2(dO.size || o.size) + '" font-weight="' + (dO.w || 400) + '" fill="' + dO.fill + '"> ' + esc(date) + '</tspan></text>');
    return t;
  }
  function wv(s, o, date, dO) { return W(s, o) + (date ? W(' ' + date, Object.assign({}, o, dO)) : 0); }
  function bv(x, y, s, o, date, dO) {
    var w = wv(s, o, date, dO), a = o.anchor || 'start', up = 0.77 * o.size, dn = 0.27 * o.size;
    return { x: a === 'start' ? x : a === 'end' ? x - w : x - w / 2, y: y - up, w: w, h: up + dn };
  }

  /* One plant in line art, standing on the soil at (x, b) and growing up; h is a grown plant's height.
     Corn: emerged, V6, silk (tassel and silks), dent (the ear filled), black layer (leaves down, ear angled).
     Soybeans: emerged (two seed leaves), V3, flowering, seed fill (pods), maturing (pods, leaves gone).
     Returns {svg, top (how high the ink reaches above b), half (half its width)}. */
  function plantArt(kind, key, x, b, ink, h) {
    var p = [], top = 8, half = 6;
    var L = function (d) { p.push('<path d="' + d + '"/>'); };
    var leaf = function (y, side, len, droop) {
      var ex = x + side * len, ey = b - y + (droop === undefined || droop === null ? -len * 0.35 : droop);
      L('M' + n2(x) + ',' + n2(b - y) + 'Q' + n2(x + side * len * 0.55) + ',' + n2(b - y - len * 0.45) + ' ' + n2(ex) + ',' + n2(ey));
      half = Math.max(half, len + 1);
    };
    if (kind === 'corn') {
      if (key === 'VE') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - 7)); leaf(6, 1, 5); leaf(5, -1, 4); top = 9; }
      else if (key === 'V6') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - h * 0.45)); leaf(h * 0.12, -1, 9); leaf(h * 0.2, 1, 10); leaf(h * 0.3, -1, 10); leaf(h * 0.4, 1, 9); top = h * 0.45 + 4; }
      else {
        var dry = key === 'R6', droop = key === 'R5' || dry;
        L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - h));
        [0.18, 0.32, 0.46, 0.6, 0.74].forEach(function (f, k) { leaf(h * f, k % 2 ? 1 : -1, dry ? 9 : 12, droop ? (dry ? 9 : 3) : null); });
        L('M' + n2(x) + ',' + n2(b - h) + 'l-4,-6M' + n2(x) + ',' + n2(b - h) + 'l4,-6M' + n2(x) + ',' + n2(b - h) + 'v-8');
        var ey = b - h * 0.5;
        if (key === 'R1') p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q4,-2 4,-9q0,-4 -3,-4"/><path d="M' + n2(x + 4) + ',' + n2(ey - 13) + 'q3,-4 6,-3M' + n2(x + 4) + ',' + n2(ey - 13) + 'q4,-1 7,2"/>');
        else if (key === 'R5') p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q6,-2 6,-11q0,-4 -4,-4z"/>');
        else if (dry) p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q8,1 10,8q-6,3 -10,-2z"/>');
        top = h + 8; half = Math.max(half, 13);
      }
    } else {
      var tri = function (cx, cy, r) {
        [-1, 0, 1].forEach(function (k) { var a = -Math.PI / 2 + k * 0.9, ex = cx + Math.cos(a) * r, ey2 = cy + Math.sin(a) * r;
          p.push('<ellipse cx="' + n2(ex) + '" cy="' + n2(ey2) + '" rx="' + n2(r * 0.55) + '" ry="' + n2(r * 0.9) + '" transform="rotate(' + n2(k * 50) + ' ' + n2(ex) + ' ' + n2(ey2) + ')"/>'); });
      };
      var bh = h * 0.6;
      if (key === 'VE') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - 6)); p.push('<ellipse cx="' + n2(x - 3) + '" cy="' + n2(b - 7) + '" rx="3" ry="1.8"/><ellipse cx="' + n2(x + 3) + '" cy="' + n2(b - 7) + '" rx="3" ry="1.8"/>'); top = 9; half = 7; }
      else if (key === 'V3') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - bh * 0.55)); tri(x, b - bh * 0.55, 3.2); L('M' + n2(x) + ',' + n2(b - bh * 0.3) + 'l-7,-4'); tri(x - 8, b - bh * 0.3 - 5, 2.6); top = bh * 0.55 + 7; half = 12; }
      else {
        L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - bh));
        [[0.3, -1], [0.5, 1], [0.7, -1]].forEach(function (q) { L('M' + n2(x) + ',' + n2(b - bh * q[0]) + 'l' + n2(q[1] * 8) + ',-5'); if (key !== 'R7') tri(x + q[1] * 9, b - bh * q[0] - 7, 2.6); });
        if (key !== 'R7') tri(x, b - bh - 4, 3);
        if (key === 'R1') p.push('<circle cx="' + n2(x + 3) + '" cy="' + n2(b - bh * 0.45) + '" r="1.4"/>');
        if (key === 'R5' || key === 'R7') [0.25, 0.45, 0.65].forEach(function (f) { p.push('<path d="M' + n2(x + 1) + ',' + n2(b - bh * f) + 'q4,1 4,6"/>'); });
        top = bh + 8; half = 13;
      }
    }
    return { svg: '<g fill="none" stroke="' + ink + '" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round">' + p.join('') + '</g>', top: top, half: half };
  }

  /* The crop's stages on the horizontal axis (Staircase) or the ground line (Roots), the soil surface: each
     stage's plant (when the buyer wants the drawings) or a small tick, and its words above it, in the footnote
     voice. g = {xs(doy) the day's middle, base (the soil's y), room, inPlot(box), avoid: [x] (drop lines and
     frost marks a plant must stand clear of), blocked(x0, x1) (snow on the ground there: Roots), minTop}.
     Returns {svg (drawn behind the data), labels (drawn on top), foot: [words that found no room]}. */
  function cropLayer(I, g) {
    var c = I.crop, out = { back: '', front: '', foot: [] };
    if (!c || !c.stages) return out;
    var base = g.base, draw = !!c.drawings, room = g.room, back = [], front = [], PH = g.plantH || PLANT_H;
    var fit = function (x, half) {
      // a plant stands clear of drop lines and frost marks (3 u) and of snow on the ground: moved up to 10 u, else not drawn
      var ok = function (cx) {
        if (g.avoid.some(function (ax) { return Math.abs(ax - cx) < half + 3; })) return false;
        return !(g.blocked && g.blocked(cx - half, cx + half));
      };
      for (var d = 0; d <= 10; d += 2) { if (ok(x + d)) return x + d; if (d && ok(x - d)) return x - d; }
      return null;
    };
    if (draw && c.ghost) c.ghost.forEach(function (s) {
      if (s.doy > c.harvest) return;
      var a0 = plantArt(c.kind, s.key, 0, base, GHOST_INK, PH), x = fit(g.xs(s.doy), a0.half);
      if (x === null) return;
      back.push(plantArt(c.kind, s.key, x, base, GHOST_INK, PH).svg);
    });
    var st = c.stages.filter(function (s) { return s.doy <= c.harvest; });
    var heads = st.map(function (s) {
      var x = g.xs(s.doy), top = 9, at = x;
      if (draw) {
        var a0 = plantArt(c.kind, s.key, 0, base, CROP_INK, PH), fx = fit(x, a0.half);
        if (fx !== null) {
          var a = plantArt(c.kind, s.key, fx, base, CROP_INK, PH);
          back.push(a.svg); top = a.top; at = fx;
          room.add({ b: { x: fx - a.half, y: base - a.top, w: 2 * a.half, h: a.top }, own: 'crop', k: 'mark' });
        }
      }
      if (!draw || at === x && top === 9) {
        back.push(line(x, base - 1, x, base - 7, CROP_INK, 0.9));
        room.seg(x, base - 1, x, base - 7, 0.9, 'crop', 'lead');
      }
      return { s: s, x: at, top: top };
    });
    /* The words: one tidy row over the plants (two or three rows when they crowd), each over its own plant
       (rowSolve: the words span the plant's x), with a hairline down to it; a stage with no clean spot is said
       in the foot line, never dropped. */
    var maxTop = Math.max.apply(null, [9].concat(heads.map(function (h) { return h.top; })));
    var items = heads.map(function (hd, k) {
      var s = hd.s, note = c.note && c.note.key === s.key ? c.note.text : '', date = fmtDate(s.date);
      var w1 = wv(s.label, FACT, date, FACT_D), w2 = note ? W(note, FACT) : 0;
      return { xs: [hd.x], w: Math.max(w1, w2), k: k, hd: hd, note: note, date: date, own: 'crop:' + k };
    });
    // rows 18 apart; a stage with a note ("10 days ahead") is 15 taller, above its words
    var r0 = base - maxTop - 12, rows = [0, 1, 2, 3, 4].map(function (k) { return r0 - k * 18; }), H = [0.77 * 12, 0.27 * 12];
    var tall = function (it, b) { return it.note ? { x: b.x, y: b.y - 15, w: b.w, h: b.h + 15 } : b; };
    var okAt = function (it, b) {
      var bb = tall(it, b);
      if (g.minTop !== undefined && bb.y < g.minTop) return false;
      return g.inPlot(bb) && room.free(bb, it.own, false);
    }, pairOk = function (A, ba, ra, B, bb, rb) {
      if (hit(tall(A, ba), tall(B, bb), 8)) return false;
      // a higher label's hairline down to its plant may not cut a lower label
      var through = function (x, b) { return x > b.x - 4 && x < b.x + b.w + 4; };
      if (ra > rb && through(A.xs[0], tall(B, bb))) return false;
      if (rb > ra && through(B.xs[0], tall(A, ba))) return false;
      return true;
    }, bounds = [g.x0 || 62, g.x1 || 1738];
    // a stage whose words fit nowhere on their own goes to the foot line; then, while the rest can't all fit, the widest one does
    var live = items.filter(function (it) { return rowSolve([it], rows, okAt, pairOk, H, bounds); }), sol = null, solOf = {};
    for (;;) {
      sol = live.length ? rowSolve(live, rows, okAt, pairOk, H, bounds) : [];
      if (sol) break;
      var worst = live.slice().sort(function (p, q) { return q.w - p.w; })[0];
      live = live.filter(function (it) { return it !== worst; });
    }
    live.forEach(function (it, j) { solOf[it.k] = sol[j]; });
    items.forEach(function (it, k) {
      var hd = it.hd, s = hd.s;
      if (!solOf[k]) { out.foot.push(s.label + ' ' + it.date + (it.note ? ' (' + it.note.charAt(0).toLowerCase() + it.note.slice(1) + ')' : '')); return; }
      var x = solOf[k].x, yb = rows[solOf[k].row], cx = x + it.w / 2;
      var tb = bv(cx, yb, s.label, Object.assign({}, FACT, { anchor: 'middle' }), it.date, FACT_D);
      room.text(it.note ? { x: x, y: tb.y - 15, w: it.w, h: tb.h + 15 } : tb, it.own);
      if (it.note) front.push(T(cx, yb - 15, it.note, Object.assign({}, FACT, { fill: X.date, anchor: 'middle' })));
      front.push(tv(cx, yb, s.label, Object.assign({}, FACT, { anchor: 'middle' }), it.date, FACT_D));
      var y1 = yb + 0.27 * 12 + 3, y2 = base - hd.top - 3;
      if (y2 - y1 > 10) front.push(line(hd.x, y1, hd.x, y2, '#C9CDD2', 0.7));
    });
    out.back = back.length ? G0('crop') + back.join('') + G1 : '';
    out.front = front.length ? G0('crop') + front.join('') + G1 : '';
    return out;
  }
  // a crop's foot line: what was counted, from where (the engine writes it; a stage that found no room joins it)
  function cropFoot(I, more) {
    var c = I.crop, f = [];
    if (!c) return f;
    (c.foot || []).forEach(function (t) { f.push(t); });
    if (more && more.length) f.push((c.name || 'Crop') + ': ' + more.join(', '));
    return f;
  }

  /* Frost marks (input.temp.frost, on by default): the last spring frost and the first fall frost, a tiny
     mark on the date axis (or ground line) and its words in the footnote voice near it. */
  function frostLayer(I, g) {
    var t = I.temp, out = { svg: '', foot: [], xs: [] };
    if (!t || !t.frost || !t.frost.length) return out;
    var o = [];
    t.frost.forEach(function (f, k) {
      if (!(f.doy >= 0)) return;
      var x = g.xs(f.doy), own = 'frost:' + k, words = f.key === 'last' ? 'Last frost' : 'First frost', date = fmtDate(f.date);
      out.xs.push(x);
      g.room.add({ b: { x: x - 4.5, y: g.base - 9, w: 9, h: 9 }, own: own, k: 'mark' });
      var cands = [];
      for (var dy = 14; dy <= 110; dy += 12) cands.push([0, -dy, 'middle'], [7, -dy, 'start'], [-7, -dy, 'end']);
      if (g.below) for (var dy2 = 20; dy2 <= 80; dy2 += 12) cands.push([0, dy2, 'middle'], [7, dy2, 'start'], [-7, dy2, 'end']);
      var pick = null;
      for (var i = 0; i < cands.length && !pick; i++) {
        var b = bv(x + cands[i][0], g.base + cands[i][1], words, Object.assign({}, FACT, { anchor: cands[i][2] }), date, FACT_D);
        if (g.inPlot(b) && g.room.free(b, own, false)) pick = { x: x + cands[i][0], y: g.base + cands[i][1], a: cands[i][2], b: b };
      }
      o.push(G0(own) + '<path d="M' + n2(x - 4) + ',' + n2(g.base - 8) + 'L' + n2(x + 4) + ',' + n2(g.base - 8) + 'L' + n2(x) + ',' + n2(g.base - 1.5) + 'z" fill="' + X.fact + '"/>');
      if (pick) { g.room.text(pick.b, own); o.push(tv(pick.x, pick.y, words, Object.assign({}, FACT, { anchor: pick.a }), date, FACT_D)); }
      else out.foot.push(words + ' ' + date);
      o.push(G1);
    });
    out.svg = o.join('');
    return out;
  }

  /* The temperature ribbon (input.temp.ribbon, off by default): each day's high and low as a short upright
     stroke in a thin band, colored by the day's middle temperature from cool gray-blue through warm stone to
     rust. A day with no high or low is a gap. b = {x0 (left of day 0), w (a day), y0, h, side 'left' | 'right'}. */
  var RIBBON_H = 36, RIB_STOPS = [[-20, [128, 149, 168]], [32, [169, 180, 189]], [58, [205, 191, 168]], [78, [200, 154, 114]], [100, [169, 88, 58]]];
  function ribbonInk(t) {
    var s = RIB_STOPS, i = 0;
    if (t <= s[0][0]) i = 0; else if (t >= s[s.length - 1][0]) i = s.length - 2; else while (t > s[i + 1][0]) i++;
    var a = s[i], b = s[i + 1], f = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
    var hx = function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); };
    return '#' + [0, 1, 2].map(function (k) { return hx(a[1][k] + (b[1][k] - a[1][k]) * f); }).join('').toUpperCase();
  }
  function ribbon(I, b) {
    var r = I.temp && I.temp.ribbon;
    if (!r || !r.scale) return '';
    var sc = r.scale, yv = function (v) { return b.y0 + (sc.hi - v) * b.h / (sc.hi - sc.lo); }, sw = Math.max(0.8, b.w * 0.78), o = [];
    for (var i = 0; i < r.hi.length && i < b.n; i++) {
      var hi = r.hi[i], lo = r.lo[i];
      if (hi === null || lo === null || hi === undefined || lo === undefined) continue;
      var x = b.x0 + (i + 0.5) * b.w, ya = yv(Math.min(sc.hi, hi)), yb = yv(Math.max(sc.lo, lo));
      if (yb - ya < 1.2) { ya -= 0.6; yb += 0.6; }
      o.push('<line x1="' + n2(x) + '" y1="' + n2(ya) + '" x2="' + n2(x) + '" y2="' + n2(yb) + '" stroke="' + ribbonInk((hi + lo) / 2) + '"/>');
    }
    var deg = function (v) { return Math.round(v) + '°'; }, ts = { size: 11, fill: X.date, anchor: b.side === 'right' ? 'start' : 'end' }, tx = b.side === 'right' ? b.x1 + 8 : b.x0 - 12;
    return G0('ribbon') + '<g stroke-width="' + n2(sw) + '" stroke-linecap="butt">' + o.join('') + '</g>' +
      T(tx, b.y0 + 8, deg(sc.hi), ts) + T(tx, b.y0 + b.h, deg(sc.lo), ts) + G1;
  }
  function ribbonFoot(I) {
    var r = I.temp && I.temp.ribbon;
    return r && r.scale ? 'Band: each day’s high and low, ' + r.scale.lo + '°F to ' + r.scale.hi + '°F, gray-blue cold to rust hot' : '';
  }

  // ======================================================================= R1 "Staircase", A2 clean (Sig, 2026-10-17)
  /* The typographer's list on one left edge: a two-line header ("32% less than a usual year" over "25.52 in
     this year · 37.73 in a usual year"), two label voices (a marked day 15 u Medium in ink with its date in
     gray; the station's facts 12 u Regular, gray footnotes below the line), the snow total in the foot line,
     no gridline without its number, month totals 14 u tabular in ink with the usual total 11 u under it, the
     dedication in plain italic. Warm stone (#ECE6DE) behind a usual year, the pale blue ahead of it; the year
     as large as the name; word-only line ends ("your year", "usual") and the "12.21 in short" bracket.
     Every year behind the year (input.hist) draws as warm gray threads behind it. */
  var STAIR_W = 4.6, USUAL_W = 1.5;
  var PRINT_DRY_MIN = 14;
  function printDryMin(I) { var v = +I.printDryMin; return v > 0 && isFinite(v) ? v : PRINT_DRY_MIN; }
  function r1(I, wetFoot) {
    var E = model(I), N = E.N, days = E.days, skipped = [];
    var hasRib = !!(I.temp && I.temp.ribbon && I.temp.ribbon.scale);
    var X0 = 196, X1 = 1590, PTOP = 104, MB = 716, PB = hasRib ? MB - 52 : MB, w = (X1 - X0) / N;
    var xs = function (i) { return X0 + i * w; };
    var lastCum = function (i) { for (var k = i; k >= 0; k--) if (E.cum[k] !== null) return E.cum[k]; return 0; };
    var recs = recordPoints(E, I.records);
    var hist = I.hist && I.hist.threads && I.hist.threads.length ? I.hist : null;
    var room = new Room(), o = [open(I, E)];
    var full = !E.preview || E.n >= N;

    // ---- the header, upper left on the one left edge: the verdict, then the key row
    var hs = { fam: SERIF, w: 600, size: 30, fill: X.ink };
    var head = E.verdict || (LOC.fr ? E.TU + ' de ' : LOC.mm ? E.TU + ' of ' : E.T + ' inches of ') + E.liquid + E.soFar;
    var HY = PTOP + 18, KY = HY + 32;
    var ks = { size: 15, w: 500, fill: C.rain }, us = { size: 15, w: 400, fill: C.mute }, sep = { size: 15, fill: C.soft };
    var yTxt = E.TU + ' ' + tr(E.preview ? 'so far' : 'this year'), uTxt = E.cmp ? rainAmt(E.normalRec, 'tot') + ' ' + tr(E.preview ? 'a usual year by then' : E.unrecorded ? 'a usual year, same days' : 'a usual year') : '';
    // with nothing to compare the headline already says the total: no key row (no total said twice)
    var keyW = E.cmp ? 34 + W(yTxt, ks) + 36 + 34 + W(uTxt, us) : 0;
    if (!E.cmp) KY = HY;
    var histNote = hist && hist.note ? hist.note : '';
    // the biggest rain with no clean spot on the chart is a red line in the header (never dropped)
    var wetHeadY = wetFoot && E.wet ? KY + 24 : 0, NY = (wetHeadY || KY) + 22;
    var HB = (histNote ? NY : wetHeadY || KY) + 6;
    var wetHeadW = wetHeadY ? wv(colon(E.wetLabel) + rainAmt(E.wet.p, 'day'), { size: 15, w: 500 }, fmtDate(E.wet.date), { size: 15, w: 400 }) : 0;
    var headBox = { x: X0 - 4, y: HY - 26, w: Math.max(W(head, hs), keyW, histNote ? W(histNote, FACT) : 0, wetHeadW) + 12, h: HB - HY + 30 };
    room.add({ b: headBox, own: 'head', k: 'mark' });

    // ---- the name block, the year as large as the name, one left edge (a logo, if any, first)
    var NB = 905, title = [], lg = logoOf(I, 'r1'), TX = lg ? X0 + lg.w + LOGO_GAP : X0;
    var nameSize = 64;
    if (E.name) {
      var nmS = { fam: SERIF, w: 500, size: 64, fill: X.ink }, yrS = { fam: SERIF, w: 400, size: 64, fill: X.ink }, gapX = 26;
      while (nmS.size > 40 && W(E.name, nmS) + gapX + W(String(E.year), nmS) > 1370 - (TX - X0)) { nmS.size--; yrS.size = nmS.size; }
      nameSize = nmS.size;
      title.push([TX - 2, NB, E.name, nmS]);
      title.push([TX - 2 + W(E.name, nmS) + gapX, NB, String(E.year), yrS]);
    } else title.push([TX - 2, NB, String(E.year), { fam: SERIF, w: 400, size: 64, fill: X.ink }]);
    var plS = { fam: SERIF, w: 400, size: fit(E.place, { fam: SERIF, w: 400, size: 22 }, 1370 - (TX - X0), 16), fill: X.ink };
    title.push([TX, NB + 40, E.place, plS]);
    var dedSize = E.dedication ? fit(E.dedication, { fam: SERIF, it: true, w: 400, size: 17 }, 1370 - (TX - X0), 13) : 0;
    title.forEach(function (t) { room.text(box(t[0], t[1], t[2], t[3]), 'title'); });
    if (E.dedication) room.text(box(TX, NB + 70, E.dedication, { fam: SERIF, it: true, size: dedSize }), 'title');
    if (lg) {
      var lockTop = NB - 0.77 * nameSize, lockBase = NB + 40;
      lg.x = X0; lg.y = n2((lockTop + lockBase) / 2 - lg.h / 2);
      room.add({ b: { x: lg.x, y: lg.y, w: lg.w, h: lg.h }, own: 'logo', k: 'mark' });
    }
    var QR_R = 1690, QR_B = 1081, qb = qrBox(I.qr, QR_R, QR_B);
    if (qb) room.add({ b: qb, own: 'qr', k: 'mark' });

    // ---- the scale: every labelled line clear of the header, no gridline without its number
    var top = Math.max(E.total, E.cmp ? E.normalRec : 0, 1);
    if (hist) hist.threads.forEach(function (h) { top = Math.max(top, h.cum[Math.min(h.cum.length, N) - 1] || 0); });
    var K = LOC.mm ? MM : 1, topK = top * K;
    var stepK = LOC.mm ? (topK > 2000 ? 500 : topK > 1000 ? 200 : topK > 400 ? 100 : topK > 150 ? 50 : topK > 60 ? 20 : 10) : (top > 60 ? 10 : top > 12 ? 5 : top > 5 ? 2 : 1);
    var step = stepK / K, dom = Math.ceil(topK / stepK - 1e-6) * stepK / K;
    var y = function (v) { return PB - v * (PB - PTOP) / dom; };
    // the year and the usual year keep out of the header: the scale grows a step at a time until they do
    var crossHead = function () {
      var hb = { x: headBox.x, y: headBox.y, w: headBox.w, h: headBox.h }, bad = false, prev = 0;
      days.forEach(function (x, i) {
        if (bad || xs(i) > hb.x + hb.w + 8) return;
        var c = E.cum[i] === null ? prev : E.cum[i];
        if (y(Math.max(c, E.cmp ? E.ncum[i] : 0)) < hb.y + hb.h + 8) bad = true;
        prev = c;
      });
      return bad;
    };
    for (var grow = 0; grow < 40 && crossHead(); grow++) dom += step;
    var ticks = [];
    for (var v = 0; v <= dom + 1e-9; v += step) if (v === 0 || y(v) > HB + 18) ticks.push(v);
    var topTick = ticks[ticks.length - 1];
    var tickNum = function (v) { return LOC.mm ? num(Math.round(v * MM), 0) : String(+v.toFixed(6)); };
    ticks.forEach(function (v) { if (v > 0) room.seg(X0, y(v), X1, y(v), 0.7, 'axis', 'soft'); room.text(box(X0 - 12, y(v) + 4.5, tickNum(v), { size: 13, anchor: 'end' }), 'axis'); });
    room.seg(X0, PB, X1, PB, 0.9 * PT, 'axis', 'axis');
    E.starts.concat([isLeap(E.year) ? 366 : 365]).forEach(function (b) { if (b <= N) room.seg(xs(b), PB, xs(b), PB + 7, 0.75 * PT, 'axis', 'axis'); });

    // ---- the year, as segments for the room and as a path
    var d1 = '', prev = 0, pen = false;
    days.forEach(function (x, i) {
      if (E.P[i] === null) { pen = false; return; }
      var c = E.cum[i];
      if (!pen) { d1 += 'M' + n2(xs(i)) + ',' + n2(y(prev)); pen = true; }
      if (c !== prev) room.seg(xs(i), y(prev), xs(i), y(c), STAIR_W, 'data', 'data');
      room.seg(xs(i), y(c), xs(i + 1), y(c), STAIR_W, 'data', 'data');
      d1 += 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(i + 1)) + ',' + n2(y(c));
      prev = c;
    });
    var np = '';
    if (E.cmp) {
      var px = X0, py = PB; np = 'M' + X0 + ',' + PB;
      days.forEach(function (x, i) { var qx = xs(i + 1), qy = y(E.ncum[i]); room.seg(px, py, qx, qy, USUAL_W, 'data', 'usual'); np += 'L' + n2(qx) + ',' + n2(qy); px = qx; py = qy; });
    }
    var pvTop = PTOP;
    if (E.preview && E.n < N) { if (xs(E.n) > headBox.x - 6 && xs(E.n) < headBox.x + headBox.w + 6) pvTop = headBox.y + headBox.h + 6; room.seg(xs(E.n), pvTop, xs(E.n), PB, 1, 'data', 'usual'); }
    var inPlot = function (b) { return b.x > X0 + 4 && b.x + b.w < X1 - 2 && b.y + b.h < PB - 6 && b.y > HB + 4; };
    var inPlotLow = function (b) { return b.x > X0 + 4 && b.x + b.w < X1 - 2 && b.y + b.h < PB - 2 && b.y > HB + 4; };

    // ---- marked days: the only dark labels, above the line, each with a drop line to the axis
    var mO = { size: 15, w: 500, fill: X.ink }, mD = { size: 15, w: 400, fill: X.date };
    var marks = E.markers.map(function (mk, k) { return { k: k, i: mk.i, x: xs(mk.i + 0.5), y: y(lastCum(mk.i)), words: mk.words, date: mk.date, label: mk.label }; });
    var rings = recs.pts.map(function (r, k) { var rg = { x: xs(r.i + 0.5), y: y(lastCum(r.i)) }; room.add({ b: { x: rg.x - 5, y: rg.y - 5, w: 10, h: 10 }, own: 'rec:' + k, k: 'mark' }); return rg; });
    marks.forEach(function (mk) {
      mk.y0 = mk.y + 5;
      for (var pass = 0; pass < 3; pass++) {
        marks.forEach(function (d) { if (d !== mk && Math.abs(d.x - mk.x) < 7 && d.y + 6.5 > mk.y0) mk.y0 = d.y + 7; });
        rings.forEach(function (rg) { if (Math.abs(rg.x - mk.x) < 7.5 && rg.y + 7 > mk.y0) mk.y0 = rg.y + 7.5; });
      }
      room.add({ b: { x: mk.x - 5, y: mk.y - 5, w: 10, h: 10 }, own: 'mark:' + mk.k, k: 'mark' });
      if (mk.y0 < PB) room.seg(mk.x, mk.y0, mk.x, PB, 0.75, 'mark:' + mk.k, 'lead');
    });
    var wx = -1, wc0 = 0, wc1 = 0;
    if (E.wi >= 0) { wx = xs(E.wi); wc1 = E.cum[E.wi]; wc0 = wc1 - E.wet.p; room.seg(wx, y(wc0), wx, y(wc1), STAIR_W, 'wet', 'data'); }

    // ---- frost marks and the crop on the axis, the soil surface (before the words that float, so those keep off them)
    var frost = frostLayer(I, { xs: function (d) { return xs(d + 0.5); }, base: PB, room: room, inPlot: inPlotLow });
    var crop = cropLayer(I, { xs: function (d) { return xs(d + 0.5); }, base: PB, room: room, inPlot: inPlotLow, minTop: HB + 4, x0: X0, x1: X1,
      avoid: marks.map(function (mk) { return mk.x; }).concat(frost.xs) });

    function placeNear(ax, ay, words, o1, date, dO, own, cands, lim) {
      return choose(cands.map(function (c) { return { x: ax + c[0], y: ay + c[1], a: c[2] }; }).concat(spots(ax, ay, [], [12, 30, 60, 100]).filter(function (c) { return c.y < ay + (lim.below ? 400 : 0); })), function (c) {
        var b = bv(c.x, c.y, words, Object.assign({}, o1, { anchor: c.a }), date, dO);
        if (!inPlot(b)) return 0;
        if (lim.above && b.y + b.h > ay - 2 && Math.abs(c.x - ax) < 12) return 0;
        if (lim.rg && b.y < ay + 6) return 0;
        var L = [ax, ay, c.x + (c.a === 'start' ? -3 : 3), b.y + b.h / 2];
        if (Math.hypot(L[2] - L[0], L[3] - L[1]) > lim.d) return 0;
        if (!room.clear(L, own, 7)) return 0;
        // the biggest rain's leader leaves its riser clear of every dot and ring (a date on that day sits on the riser)
        if (lim.dots && lim.dots.some(function (d) { return segRect(L, { x: d.x - 5.5, y: d.y - 5.5, w: 11, h: 11 }, 1); })) return 0;
        if (!room.free(b, own, false)) return 0;
        c.b = b; c.L = L;
        return room.free(b, own, true) ? 2 : 1;
      });
    }
    // the biggest rain first (it sits close to its riser), red, a marked day's voice
    var wetAt = null, wO = { size: 15, w: 500, fill: X.red }, wetWords = colon(E.wetLabel) + (E.wet ? rainAmt(E.wet.p, 'day') : '');
    if (wx >= 0 && !wetFoot) {
      var wmy = (y(wc0) + y(wc1)) / 2;
      wetAt = placeNear(wx, wmy, wetWords, wO, fmtDate(E.wet.date), mD, 'wet', [[-12, -22, 'end'], [-12, -46, 'end'], [-14, 0, 'end'], [-14, -70, 'end'], [12, 40, 'start']], { d: 140, dots: marks.concat(rings) });
      if (wetAt) { room.text(wetAt.b, 'wet'); room.seg(wetAt.L[0], wetAt.L[1], wetAt.L[2], wetAt.L[3], 0.8, 'wet', 'lead'); }
      else return r1(I, true);
    }
    // the reader's days: on the line where there is room, else in a row under the months, never dropped
    var rowMarks = [], labelOf = {};
    marks.forEach(function (mk) {
      if (!mk.label) return;
      var own = 'mark:' + mk.k;
      var pick = placeNear(mk.x, mk.y, mk.words, mO, mk.date, mD, own,
        [[-12, -16, 'end'], [12, -16, 'start'], [-14, -40, 'end'], [14, -40, 'start'], [-14, -64, 'end'], [14, -64, 'start'], [-16, -90, 'end'], [16, -90, 'start']], { d: 120, above: true });
      if (!pick) { rowMarks.push(mk); return; }
      room.text(pick.b, own);
      if (Math.hypot(pick.L[2] - pick.L[0], pick.L[3] - pick.L[1]) > 16) room.seg(pick.L[0], pick.L[1], pick.L[2], pick.L[3], 0.8, own, 'lead'); else pick.L = null;
      labelOf[mk.k] = { line: true, at: pick };
    });

    // ---- the month row: labels 11 u tracked, totals 14 u tabular ink, the usual total 11 u light
    var months = [], tab = function (s) { return s.replace('lining-nums', 'tabular-nums lining-nums'); };
    E.starts.forEach(function (b, m) {
      var cx = (xs(b) + xs(E.ends[m])) / 2;
      months.push([cx, MB + 26, monCap(m), { w: 500, size: 11, ls: 0.08, fill: X.date, anchor: 'middle' }]);
      if (E.monthHas[m]) months.push([cx, MB + 46, rainNum(E.month[m], 'tot'), { size: 14, fill: X.ink, anchor: 'middle' }]);
      if (E.showN) months.push([cx, MB + 63, rainNum(E.mN[m], 'tot'), { size: 11, fill: X.usualM, anchor: 'middle' }]);
    });
    months.forEach(function (t) { room.text(box(t[0], t[1], t[2], t[3]), 'months'); });
    if (hasRib) room.add({ b: { x: X0 - 4, y: PB + 10, w: X1 - X0 + 48, h: RIBBON_H + 4 }, own: 'ribbon', k: 'mark' });
    // the dry stretch, a footnote under the months
    var dry = null, footFacts = [];
    if (E.dry && E.dry.len >= printDryMin(I)) {
      var da = xs(E.dry.s), db = xs(E.dry.e + 1), ry = MB + 78;
      dry = { a: da, b: db, ry: ry, text: E.dry.len + (LOC.fr ? ' jours secs' : ' dry days') };
      room.seg(da, ry, db, ry + 5, 0.7, 'dry', 'lead');
      var dbx = box((da + db) / 2, ry + 20, dry.text, { size: 12, anchor: 'middle' });
      if (room.free(dbx, 'dry', false) && dbx.x > X0 - 20 && dbx.x + dbx.w < 1770) room.text(dbx, 'dry');
      else { dry.words = false; footFacts.push(LOC.fr ? 'Plus longue période sèche : ' + E.dry.len + ' jours, ' + E.dry.range : 'Longest dry stretch: ' + E.dry.len + ' days, ' + E.dry.range); }
    }
    // marked days with no room on the line: a row under the months, over a tick under the axis
    var placedDates = [];
    if (rowMarks.length) {
      var rowSt = Object.assign({}, mO);
      placedDates = placeDates(rowMarks, [MB + 104, MB + 126], function (s) { return W(s, rowSt); },
        function (it, b) { return b.y + b.h < NB - 0.77 * nameSize - 8 && room.free(b, 'mark:' + it.ids[0], false); },
        function (A, ba, ra, B, bb, rb) { return !hit(ba, bb, ra === rb ? 20 : 2); }, [0.77 * 15, 0.27 * 15], [X0, 1738]);
      placedDates.forEach(function (pd) {
        pd.own = 'mark:' + pd.it.ids[0];
        pd.box = box(pd.x, pd.y, pd.it.label, rowSt); pd.st = rowSt;
        room.text(pd.box, pd.own);
        pd.it.ids.forEach(function (id) { marks[id].tick = true; room.seg(marks[id].x, PB + 8, marks[id].x, PB + 14, 0.75, 'mark:' + id, 'lead'); });
        labelOf[pd.it.ids[0]] = pd;
      });
    }

    // ---- the station's facts: 12 u gray footnotes, below the line; one with no room goes to the foot line
    var recAt = placeAll(recs.pts, function (k) {
      // the words carry their date as a run (T draws it gray, a tie note after it back in the words' voice)
      var r = recs.pts[k], words = r.text, date = '';
      var rg = rings[k], own = 'rec:' + k;
      var pick = placeNear(rg.x, rg.y, words, FACT, date, FACT_D, own,
        [[10, 24, 'start'], [-10, 24, 'end'], [12, 44, 'start'], [-12, 44, 'end'], [14, 66, 'start'], [-14, 66, 'end'], [16, 90, 'start'], [-16, 90, 'end'], [40, 30, 'start'], [-40, 30, 'end'], [60, 56, 'start'], [-60, 56, 'end']], { d: 170, below: true, rg: rg });
      // no room under the line (early in the year it runs along the axis): above it, still a footnote
      if (!pick) pick = placeNear(rg.x, rg.y, words, FACT, date, FACT_D, own,
        [[10, -14, 'start'], [-10, -14, 'end'], [12, -36, 'start'], [-12, -36, 'end'], [14, -60, 'start'], [-14, -60, 'end'], [40, -24, 'start'], [-40, -24, 'end']], { d: 140 });
      if (!pick) return null;
      var its = [room.text(pick.b, own), room.seg(pick.L[0], pick.L[1], pick.L[2], pick.L[3], 0.7, own, 'lead')];
      pick.words = words; pick.date = date; its.pick = pick;
      return its;
    }, []);
    // a fact with no room on the chart is said in the foot line instead (never dropped)
    recs.pts.forEach(function (r, k) { if (!recAt[k]) footFacts.push(r.text); });

    // ---- line ends ("your year", "usual"), the gap at Dec 31, and every year behind's remarkable ones
    var ends = [], endBoxes = [], EX = X1 + 12, endY = y(E.total), endN = E.cmp ? y(E.normalRec) : null;
    if (full) {
      var yw = tr('your year'), uw = tr('usual');
      ends.push(T(EX, endY + 5, yw, { size: 15, w: 500, fill: C.rain })); endBoxes.push(box(EX, endY + 5, yw, { size: 15, w: 500 }));
      if (E.cmp) { ends.push(T(EX, endN + 5, uw, { size: 15, fill: C.mute })); endBoxes.push(box(EX, endN + 5, uw, { size: 15 })); }
      var gap = E.cmp ? E.normalRec - E.total : 0;
      if (E.cmp && Math.abs(gap) >= 0.5 && Math.abs(endY - endN) > 60) {
        var bx = X1 + 6, ya = Math.min(endY, endN) + 16, yb = Math.max(endY, endN) - 16, mid = (ya + yb) / 2, bt = rainAmt(Math.abs(gap), 'tot') + (LOC.fr ? (gap > 0 ? ' de moins' : ' de plus') : gap > 0 ? ' short' : ' ahead');
        ends.push('<path d="M' + n2(bx + 5) + ',' + n2(ya) + 'H' + n2(bx) + 'V' + n2(yb) + 'H' + n2(bx + 5) + '" fill="none" stroke="' + X.date + '" stroke-width="0.8"/>' + T(bx + 12, mid + 5, bt, { size: 15, w: 500, fill: X.ink }));
        endBoxes.push({ x: bx - 2, y: ya, w: 14 + W(bt, { size: 15, w: 500 }), h: yb - ya });
      }
    }
    var histLabels = [];
    if (hist && full && hist.labels) {
      var want = (hist.labels.wet || []).concat(hist.labels.dry || []);
      var placedH = [];
      want.forEach(function (yr) {
        var th = hist.threads.filter(function (t) { return t.year === yr; })[0];
        if (!th) return;
        var ty = y(th.cum[Math.min(th.cum.length, N) - 1] || 0), s = String(yr), hO = { size: 11, fill: X.date };
        for (var d = 0; d <= 30; d += 2) {
          var found = null;
          [ty + 4 + d, ty + 4 - d].some(function (bl) {
            var b = box(X1 + 6, bl, s, hO);
            if (b.y < PTOP - 10 || b.y + b.h > PB) return false;
            if (endBoxes.some(function (e) { return hit(e, b, 3); }) || placedH.some(function (e) { return hit(e, b, 2); })) return false;
            found = { bl: bl, b: b }; return true;
          });
          if (found) {
            placedH.push(found.b);
            var lab = T(X1 + 6, found.bl, s, hO);
            if (Math.abs(found.bl - 4 - ty) > 3) lab = line(X1 + 0.5, ty, X1 + 4.5, found.bl - 4, X.date, 0.7) + lab;
            histLabels.push(lab);
            break;
          }
        }
      });
    }

    // ---- the foot: 12 u, up to three lines, "usual" said once; whatever found no room on the chart joins it
    var foot1 = [];
    if (E.gauge) foot1.push(E.gauge);
    foot1.push((LOC.fr ? 'Pouces de ' : LOC.mm ? 'Millimetres of ' : 'Inches of ') + E.liquid + (LOC.fr ? ', du 1er janv. au 31 déc. ' : ', Jan 1 to Dec 31, ') + E.year);
    if (LOC.mm) foot1[foot1.length - 1] = (LOC.fr ? 'Millimètres de ' : 'Millimetres of ') + E.liquid + (LOC.fr ? ', du 1er janv. au 31 déc. ' : ', Jan 1 to Dec 31, ') + E.year;
    if (E.snowText) foot1.push(E.snowText + (LOC.fr ? ', les marches bleu pâle' : ', the light blue steps'));
    foot1.push(E.daysText);
    var foot2 = [];
    if (E.cmp && E.ovNote) foot2.push(E.ovNote + (E.showN ? (LOC.fr ? '; le total normal du mois est le chiffre gris sous chaque mois' : '; the usual month total is the gray number under each month') : ''));
    if (E.snowNote) foot2.push(E.snowNote);
    if (hist && hist.foot) foot2.push(hist.foot);
    if (E.missing > GAP_QUIET) foot2.push(LOC.fr ? 'Trous : ' + E.missing + ' jours sans relevé' : 'Gaps: ' + E.missing + ' days with no report');
    recs.lines.forEach(function (t) { foot2.push(plain(t)); });
    var tf = (I.temp && I.temp.foot) || [];
    var extra = footFacts.concat(frost.foot, cropFoot(I, crop.foot), tf, hasRib ? [ribbonFoot(I)] : []);
    var fS = { size: 12, fill: X.fact }, SEPF = '  ·  ', FW = qb ? qb.x - 24 - X0 : 1560, lines = [[]], dropped = [];
    var addPart = function (t) { var cur = lines[lines.length - 1]; if (!cur.length || W(cur.concat([t]).join(SEPF), fS) <= FW) cur.push(t); else lines.push([t]); };
    foot1.forEach(addPart);
    lines.push([]); foot2.forEach(addPart);
    extra.forEach(function (t) {
      if (!t) return;
      for (var li = 0; li < lines.length; li++) if (lines[li].length && W(lines[li].concat([t]).join(SEPF), fS) <= FW) { lines[li].push(t); return; }
      lines = lines.filter(function (l) { return l.length; });
      if (lines.length < 5) { lines.push([t]); return; }
      dropped.push(t);
    });
    lines = lines.filter(function (l) { return l.length; });
    // a part too long for any line is cut at a word, never run past the QR
    lines = lines.map(function (l) { var s = l.join(SEPF); while (W(s, fS) > FW && s.indexOf(' ') > 0) s = s.slice(0, s.lastIndexOf(' ')).replace(/\u0001[^\u0002]*$/, ''); return s; });
    var footTop = 1081 - (lines.length - 1) * 19;
    var foot = lines.map(function (s, k) { return T(X0, footTop + k * 19, s, fS); }).join('');
    dropped.forEach(function (t) { skipped.push(t); });

    // ================= draw, back to front
    o.push(G0('axis'));
    ticks.forEach(function (v) { if (v > 0) o.push(line(X0, y(v), X1, y(v), X.grid, 0.7)); });
    ticks.forEach(function (v) { o.push(T(X0 - 12, y(v) + 4.5, tickNum(v), { size: 13, fill: X.date, anchor: 'end' })); });
    o.push(G1);
    if (hist) {
      var hpath = '';
      hist.threads.forEach(function (h) {
        var s = 'M' + X0 + ',' + PB;
        for (var i = 0; i < Math.min(h.cum.length, N); i++) s += 'L' + n2(xs(i + 1)) + ',' + n2(y(h.cum[i]));
        hpath += '<path d="' + s + '"/>';
      });
      o.push(G0('hist') + '<g fill="none" stroke="' + X.thread + '" stroke-width="0.7" stroke-linejoin="round">' + hpath + '</g>' + G1);
    }
    // warm stone behind a usual year, the pale blue ahead of it (none when the history threads take its place)
    if (E.cmp && !hist) {
      var band = '', last = 0;
      days.forEach(function (x, i) {
        if (E.cum[i] !== null) last = E.cum[i];
        var a = y(last), b = y(E.ncum[i]);
        if (Math.abs(a - b) < 0.3) return;
        band += '<rect x="' + n2(xs(i)) + '" y="' + n2(Math.min(a, b)) + '" width="' + n2(w + 0.25) + '" height="' + n2(Math.abs(a - b)) + '" fill="' + (a > b ? X.stone : X.ahead) + '"/>';
      });
      o.push(G0('data') + '<g shape-rendering="crispEdges">' + band + '</g>' + G1);
    }
    // the header on white (a history thread passes behind it)
    var hx = X0, hp = ['<rect x="' + n2(headBox.x - 4) + '" y="' + n2(headBox.y) + '" width="' + n2(headBox.w + 8) + '" height="' + n2(headBox.h) + '" fill="#FFFFFF"/>', T(hx, HY, head, hs)];
    if (E.cmp) {
      hp.push(line(hx, KY - 5, hx + 24, KY - 5, C.rain, 4)); hx += 34;
      hp.push(T(hx, KY, yTxt, ks)); hx += W(yTxt, ks);
      hp.push(T(hx + 18, KY, '·', Object.assign({}, sep, { anchor: 'middle' }))); hx += 36;
      hp.push('<path d="M' + n2(hx) + ',' + (KY - 5) + 'h24" stroke="' + C.mute + '" stroke-width="1.5" stroke-dasharray="6 5"/>'); hx += 34;
      hp.push(T(hx, KY, uTxt, us));
    }
    if (wetHeadY) hp.push(tv(X0, wetHeadY, wetWords, wO, fmtDate(E.wet.date), mD));
    if (histNote) hp.push(T(X0, NY, histNote, FACT));
    o.push(G0('head') + hp.join('') + G1);
    if (E.cmp) o.push(G0('usual') + '<path d="' + np + '" fill="none" stroke="' + C.mute + '" stroke-width="' + USUAL_W + '" stroke-dasharray="6 5"/>' + G1);
    o.push(crop.back);
    o.push(G0('axis') + line(X0, PB, X1, PB, X.ink, 0.9 * PT));
    E.starts.concat([isLeap(E.year) ? 366 : 365]).forEach(function (b) { if (b <= N) o.push(line(xs(b), PB, xs(b), PB + 7, X.ink, 0.75 * PT)); });
    o.push(G1);
    if (hasRib) o.push(ribbon(I, { x0: X0, x1: X1, w: w, n: N, y0: PB + 12, h: RIBBON_H, side: 'right' }));
    if (E.preview && E.n < N) { o.push(G0('data') + line(xs(E.n), pvTop, xs(E.n), PB, C.mute, 1, ' stroke-dasharray="3 4"') + G1); E.laterBox = { x0: xs(E.n), x1: X1, y0: pvTop, y1: PB }; }
    // the year, snow steps in ice blue on the line (above the line only)
    o.push(G0('data'));
    if (d1) o.push('<path d="' + d1 + '" fill="none" stroke="' + C.rain + '" stroke-width="' + STAIR_W + '" stroke-linejoin="round" stroke-linecap="butt"/>');
    if (E.full) {
      var sp = '';
      days.forEach(function (x, i) {
        if (E.P[i] === null || !(x.s > 0) || !(E.P[i] > 0)) return;
        var c = E.cum[i], c0 = c - E.P[i];
        var j = i + 1; while (j < E.n && E.P[j] === 0 && !(days[j].s > 0)) j++;
        sp += 'M' + n2(xs(i)) + ',' + n2(y(c0)) + 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(Math.min(j, E.n))) + ',' + n2(y(c));
      });
      if (sp) o.push('<path d="' + sp + '" fill="none" stroke="' + C.snowLine + '" stroke-width="' + STAIR_W + '" stroke-linejoin="round"/>');
    }
    o.push(G1);
    if (wx >= 0) o.push(G0('wet') + line(wx, y(wc0) + 1.5, wx, y(wc1) - 1.5, X.red, STAIR_W) + G1);
    o.push(G0('months') + months.map(function (t) { var s = T(t[0], t[1], t[2], t[3]); return t[3].size === 11 && !t[3].ls || t[3].size === 14 ? tab(s) : s; }).join(''));
    if (dry) {
      o.push('<path d="M' + n2(dry.a) + ',' + dry.ry + 'v5H' + n2(dry.b) + 'v-5" fill="none" stroke="' + X.date + '" stroke-width="0.7"/>');
      if (dry.words !== false) o.push(T((dry.a + dry.b) / 2, dry.ry + 20, dry.text, { size: 12, fill: X.fact, anchor: 'middle' }));
    }
    o.push(G1);
    o.push(frost.svg);
    recs.pts.forEach(function (r, k) {
      var pk = recAt[k], rg = rings[k];
      if (!pk) return;
      o.push(G0('rec:' + k) + '<circle cx="' + n2(rg.x) + '" cy="' + n2(rg.y) + '" r="4" fill="#FFFFFF" stroke="' + X.fact + '" stroke-width="1.2"/>' +
        '<path d="M' + n2(pk.L[0]) + ',' + n2(pk.L[1]) + 'L' + n2(pk.L[2]) + ',' + n2(pk.L[3]) + '" stroke="' + X.fact + '" stroke-width="0.7"/>' +
        tv(pk.x, pk.y, pk.words, Object.assign({}, FACT, { anchor: pk.a }), pk.date, FACT_D) + G1);
    });
    if (wetAt) o.push(G0('wet') + '<path d="M' + n2(wetAt.L[0]) + ',' + n2(wetAt.L[1]) + 'L' + n2(wetAt.L[2]) + ',' + n2(wetAt.L[3]) + '" stroke="' + X.red + '" stroke-width="0.8"/>' +
      tv(wetAt.x, wetAt.y, wetWords, Object.assign({}, wO, { anchor: wetAt.a }), fmtDate(E.wet.date), mD) + G1);
    o.push(crop.front);
    marks.forEach(function (mk) {
      o.push(G0('mark:' + mk.k));
      if (mk.y0 < PB) o.push(line(mk.x, mk.y0, mk.x, PB, X.ink, 0.75));
      o.push('<circle cx="' + n2(mk.x) + '" cy="' + n2(mk.y) + '" r="4.6" fill="' + X.ink + '" stroke="#FFFFFF" stroke-width="1.4"/>');
      if (mk.tick) o.push(line(mk.x, PB + 8, mk.x, PB + 14, X.ink, 0.75));
      var pd = labelOf[mk.k];
      if (pd && pd.line) {
        if (pd.at.L) o.push('<path d="M' + n2(pd.at.L[0]) + ',' + n2(pd.at.L[1]) + 'L' + n2(pd.at.L[2]) + ',' + n2(pd.at.L[3]) + '" stroke="' + X.ink + '" stroke-width="0.8"/>');
        o.push(tv(pd.at.x, pd.at.y, mk.words, Object.assign({}, mO, { anchor: pd.at.a }), mk.words === mk.date ? '' : mk.date, mD));
      } else if (pd) o.push(T(pd.x, pd.y, pd.it.label, Object.assign({ anchor: 'start' }, pd.st)).replace(/font-size="16" font-weight="400" fill="#5E6475"/g, 'font-size="15" font-weight="400" fill="' + X.date + '"'));
      o.push(G1);
    });
    o.push(G0('ends') + ends.join('') + histLabels.join('') + G1);
    o.push(G0('title') + title.map(function (t) { return T(t[0], t[1], t[2], t[3]); }).join('') + (E.dedication ? dedText(TX, NB + 70, E.dedication, dedSize, X.fact) : '') + G1);
    if (lg) o.push(logoMark(lg));
    o.push(G0('foot') + foot + G1);
    o.push(qrMark(I.qr, QR_R, QR_B));
    last_skipped = skipped;
    last_logo = lg ? { x: lg.x, y: lg.y, w: lg.w, h: lg.h } : null;
    return close(I, E, o, bandAt(room, [(PTOP + PB) / 2 + 60, PTOP + (PB - PTOP) * 0.78, PTOP + (PB - PTOP) * 0.3], PTOP + 40, PB - 40, X0 - 6, X1 + 6, E.preview && E.n < N ? [xs(E.n) + 12, X1 + 6] : null, 96));
  }

  // ======================================================================= R2
  /* Both scales are sized to the year itself (panel 4, 2026-10-14): the deepest rain bar reaches the foot of
     the chart (to the next tenth of an inch), the tallest snow pile the top of the snow band. They used to have
     floors of 2 in and 8 in, so a dry year was a strip of short bars over blank paper. */
  function niceRain(maxP) {
    if (LOC.mm) {
      // metric: to the next whole mm, ticks at round mm; returned in inches with the mm to print (lab)
      var dm = Math.max(12, Math.ceil(maxP * MM - 1e-6));
      var tm = dm <= 50 ? [10, 20, 30, 40, 50] : dm <= 100 ? [20, 40, 60, 80, 100] : dm <= 200 ? [50, 100, 150, 200] : [100, 200, 300, 400];
      tm = tm.filter(function (t) { return t <= dm + 1e-9; });
      return { dom: dm / MM, ticks: tm.map(function (t) { return t / MM; }), lab: tm.map(function (t) { return num(t, 0); }) };
    }
    var dom = Math.max(0.5, Math.ceil(maxP * 10 - 1e-6) / 10);
    var ticks = dom <= 2 ? [0.5, 1, 1.5, 2] : dom <= 4 ? [0.5, 1, 2, 3, 4] : dom <= 8 ? [1, 2, 4, 6, 8] : [2, 4, 8, 12, 16];
    return { dom: dom, ticks: ticks.filter(function (t) { return t <= dom + 1e-9; }) };
  }
  // the snow scale in cm: the same steps, picked in cm, returned in inches with the cm to print (lab)
  function niceSnowCm(maxS) {
    var c = niceSnowIn(Math.max(0.5, (maxS || 0) * CM));
    return { dom: c.dom / CM, ticks: c.ticks.map(function (t) { return t / CM; }), lab: c.ticks.map(function (t) { return num(t, 0); }) };
  }
  function niceSnow(maxS) { return LOC.mm ? niceSnowCm(maxS) : niceSnowIn(maxS); }
  function niceSnowIn(maxS) {
    // at most four steps on the short snow scale (a 40 in day once drew eight labels on top of each other)
    var m = Math.max(0.5, maxS || 0), steps = [1, 2, 4, 5, 10, 20, 25, 50, 100], step = steps[steps.length - 1], ticks = [];
    for (var k = 0; k < steps.length; k++) if (Math.ceil(m / steps[k] - 1e-9) <= 4) { step = steps[k]; break; }
    var dom = Math.ceil(m / step - 1e-9) * step;
    for (var t = step; t <= dom + 1e-9; t += step) ticks.push(t);
    return { dom: dom, ticks: ticks };
  }
  function r2(I) {
    var E = model(I), N = E.N, days = E.days, skipped = [];
    var ML = 120, X0 = 205, X1 = 1690, PW = X1 - X0, w = PW / N;
    var hasRib = !!(I.temp && I.temp.ribbon && I.temp.ribbon.scale);
    // the temperature ribbon takes a strip under the rain (2026-10-17): the rain scale gives it 80 units
    var G = 478, SH = 92, RB = hasRib ? 920 : 1000, RH = RB - G - 6, RIB_Y = RB + 22;
    // the rain scale reaches the deepest bar drawn below the ground (a snow day is drawn above it only)
    var maxRain = Math.max.apply(null, [0.01].concat(days.map(function (x, i) { return E.P[i] !== null && !(E.full && x.s > 0) ? E.P[i] : 0; })));
    var R = niceRain(maxRain), S = niceSnow(E.maxSnow);
    var ry = function (p) { return G + p * RH / R.dom; }, sy = function (s) { return G - s * SH / S.dom; };
    var xs = function (i) { return X0 + (i + 0.5) * w; };
    var o = [open(I, E)], room = new Room();
    var recs = recordPoints(E, I.records);
    E.style2 = true;
    var put = function (list, own) { list.forEach(function (t) { room.text(box(t[0], t[1], t[2], t[3]), own); }); };
    // the dedication in plain italic (2026-10-17, both styles)
    var draw = function (list) { return list.map(function (t) { return t[3] && t[3].it && t[3].fam === SERIF ? dedText(t[0], t[1], t[2], t[3].size, t[3].fill) : T(t[0], t[1], t[2], t[3]); }).join(''); };

    /* The top: the year's totals at the right; at the left the name, in the Staircase's serif and the biggest
       words on the sheet (panel 4, 2026-10-14), the place and year under it, the buyer's line under that. With
       no name, the place and year are the headline. A long name that has to shrink shrinks the totals with it,
       so the name stays the biggest. A logo goes first, at the left margin, and the words start after it (TX). */
    var lg = logoOf(I, 'r2'), TX = lg ? ML + lg.w + LOGO_GAP : ML;
    var vst = { size: 22, anchor: 'end' }, totals, title, rightEdge, leftRoom, nst = null, big = { w: 300, size: 68 }, snowBig = { w: 300, size: 44 };
    var NAME_MAX = 78, py = E.name ? 202 : 196;
    function layTotals() {
      totals = [];
      totals.push([X1, 214, E.TU, Object.assign({ anchor: 'end' }, big)]);
      totals.push([X1, 140, (E.liquid + (E.soFar ? (LOC.fr ? ', jusqu’ici' : ', so far') : '')).toUpperCase(), { w: 500, size: 14, ls: 0.16, fill: C.mute, anchor: 'end' }]);
      if (E.verdict) totals.push([X1, 254, E.verdict, vst]);
      rightEdge = X1 - W(E.TU, big);
      if (E.full) {
        var bxs = Math.min(rightEdge - 70, X1 - W(totals[1][2], totals[1][3]) - 40), sTot = LOC.mm ? snowAmt(E.snowRaw) : E.snowTot.toFixed(1) + ' in';
        totals.push([bxs, 214, sTot, Object.assign({ fill: C.snowInk, anchor: 'end' }, snowBig)]);
        totals.push([bxs, 140, tr('SNOWFALL'), { w: 500, size: 14, ls: 0.16, fill: C.snowInk, anchor: 'end' }]);
        rightEdge = bxs - W(sTot, snowBig);
      }
      leftRoom = rightEdge - 50 - TX;
    }
    layTotals();
    if (E.name) {
      nst = { fam: SERIF, w: 500, size: fit(E.name, { fam: SERIF, w: 500, size: NAME_MAX }, leftRoom, 40) };
      for (var shrink = 0; shrink < 12 && nst.size < big.size + 6 && big.size > 30; shrink++) {
        big.size = Math.max(30, nst.size - 8); snowBig.size = Math.round(big.size * 44 / 68);
        layTotals();
        nst.size = fit(E.name, { fam: SERIF, w: 500, size: NAME_MAX }, leftRoom, 40);
      }
    }
    title = [];
    if (E.name) {
      title.push([TX - 2, 140, E.name, nst]);
      var ps = { fam: SERIF, w: 400, size: 34 }, ys = { fam: SERIF, w: 600, size: 34 }, yw = W(String(E.year), ys) + 18;
      ps.size = ys.size = Math.min(34, nst.size - 8, fit(E.place, ps, leftRoom - yw, 22));
      title.push([TX, py, E.place, ps]);
      title.push([TX + W(E.place, ps) + 18, py, String(E.year), ys]);
    } else {
      var ps = { fam: SERIF, w: 400, size: 60 }, ys = { fam: SERIF, w: 600, size: 60 };
      ps.size = ys.size = fit(E.place + '  ' + E.year, { fam: SERIF, w: 600, size: 60 }, leftRoom, 28);
      title.push([TX, py, E.place, ps]);
      title.push([TX + W(E.place + '  ', ps), py, String(E.year), ys]);
    }
    // the dedication runs under the totals but stops short of the verdict on its line
    if (E.dedication) {
      var dRoom = (E.verdict ? X1 - W(E.verdict, vst) - 40 : X1) - TX;
      title.push([TX, py + 42, E.dedication, { fam: SERIF, it: true, size: fit(E.dedication, { fam: SERIF, it: true, size: 24 }, dRoom, 14), fill: C.mute }]);
    }
    put(totals, 'totals'); put(title, 'title');
    if (lg) {
      // centred on the name and place: from the name's capitals (or the place's) to the place's baseline
      var lgTop = E.name ? 140 - asc(E.name) * nst.size : py - asc(E.place) * ps.size;
      lg.x = ML; lg.y = n2(Math.max(64, (lgTop + py) / 2 - lg.h / 2));
      room.add({ b: { x: lg.x, y: lg.y, w: lg.w, h: lg.h }, own: 'logo', k: 'mark' });
    }

    // guides and scales
    var axisT = [];
    R.ticks.forEach(function (t, k) { room.seg(X0, ry(t), X1, ry(t), 0.7, 'axis', 'soft'); axisT.push([X0 - 14, ry(t) + 5, R.lab ? R.lab[k] : String(t), { size: 15, fill: C.mute, anchor: 'end' }]); });
    if (E.full) S.ticks.forEach(function (t, k) { room.seg(X0, sy(t), X1, sy(t), 0.7, 'axis', 'soft'); axisT.push([X0 - 14, sy(t) + 5, S.lab ? S.lab[k] : String(t), { size: 15, fill: C.snowInk, anchor: 'end' }]); });

    // bars: a snow day shows only above the line (its melted water still counts in the total)
    // bars 0.85 of a day, so a year reads as a texture across the room, not hairlines (panel 4, 2026-10-14; were 0.66)
    var bw = 0.85 * w, sw = 0.85 * w, bars = '', snows = '', barBoxes = [], snowBoxes = [];
    days.forEach(function (x, i) {
      var p = E.P[i], cx = xs(i);
      if (p === null) return;
      if (E.full && x.s > 0) {
        var h = Math.max(1.4, G - sy(x.s)), sb = { x: cx - sw / 2 + 0.35, y: G - 2.2 - h + 0.35, w: sw - 0.7, h: h - 0.7 };
        snows += '<rect x="' + n2(sb.x) + '" y="' + n2(sb.y) + '" width="' + n2(sb.w) + '" height="' + n2(sb.h) + '"/>';
        room.add({ b: sb, own: 'data', k: 'mark' }); snowBoxes.push(sb);
        return;
      }
      if (p > 0 && i !== E.wi) {
        var bb = { x: cx - bw / 2, y: G + 1.5, w: bw, h: Math.max(0.8, ry(p) - G) };
        bars += '<rect x="' + n2(bb.x) + '" y="' + bb.y + '" width="' + n2(bb.w) + '" height="' + n2(bb.h) + '"/>';
        room.add({ b: bb, own: 'data', k: 'mark' }); barBoxes.push(bb);
      }
      // trace days are not drawn: unexplained dots at the ground line read as data (designers' panel, 2026-10-13)
    });
    // ground line, broken over unrecorded days
    var seg = null, segs = [];
    days.forEach(function (x, i) { if (E.P[i] !== null) { if (!seg) seg = [i, i]; seg[1] = i; } else if (seg) { segs.push(seg); seg = null; } });
    if (seg) segs.push(seg);
    var ground = segs.map(function (sg) { return [X0 + sg[0] * w + (sg[0] ? 1 : 0), X0 + (sg[1] + 1) * w - (sg[1] < E.n - 1 ? 1 : 0)]; });
    ground.forEach(function (g) { room.seg(g[0], G, g[1], G, 1.1 * PT, 'axis', 'axis'); });
    var mticks = E.starts.concat([isLeap(E.year) ? 366 : 365]).filter(function (b) { return b <= N; }).map(function (b) { return X0 + b * w; });
    mticks.forEach(function (x) { room.seg(x, G - 7, x, G + 7, 0.75 * PT, 'axis', 'axis'); });
    var prevX = E.preview && E.n < N ? X0 + E.n * w : null;
    if (prevX !== null) room.seg(prevX, G - SH, prevX, RB, 1, 'data', 'usual');
    var wcx = -1, wy2 = 0;
    if (E.wi >= 0) { wcx = xs(E.wi); wy2 = ry(E.wet.p); barBoxes.push(room.add({ b: { x: wcx - 1.9, y: G + 1.5, w: 3.8, h: wy2 - G - 1.5 }, own: 'wet', k: 'mark' }).b); }

    if (hasRib) room.add({ b: { x: X0 - 4, y: RIB_Y - 2, w: X1 - X0 + 48, h: RIBBON_H + 4 }, own: 'ribbon', k: 'mark' });
    // the scale's names: rain at the foot of its scale, or under the soil if a bar is in the way
    var rainTitle = (E.full ? tr('rain') : E.liquid) + ', ' + rU(), rtSt = { size: 15, fill: C.mute };
    var rty = [ry(R.ticks[R.ticks.length - 1]) + 36, RB + 24, RB + 70].filter(function (yy) { return room.free(box(ML, yy, rainTitle, rtSt), 'axis', false); })[0] || RB + 24;
    axisT.push([ML, rty, rainTitle, rtSt]);
    if (E.full) axisT.push([ML, sy(S.dom) - 14, tr('snow') + ', ' + sU(), { size: 15, fill: C.snowInk }]);
    put(axisT, 'axis');

    // month labels and totals; with normals on, each month's normal under its total
    var MY = 316, TY = 345, months = [];
    E.starts.forEach(function (b, m) {
      var cx2 = X0 + (b + E.ends[m]) / 2 * w;
      months.push([cx2, MY, monCap(m), { w: 500, size: 14, ls: 0.18, fill: C.mute, anchor: 'middle' }]);
      if (!E.monthHas[m]) return;
      months.push([cx2, TY, rainNum(E.month[m], 'tot') + (m === 0 ? ' ' + rU() : ''), { w: 500, size: 20, anchor: 'middle' }]);
      if (E.showN) months.push([cx2, TY + 23, (m === 0 ? tr('usual') + ' ' : '') + rainNum(E.mN[m], 'tot'), { size: 15, fill: C.mute, anchor: 'middle' }]);
    });
    put(months, 'months');
    var mBoxes = months.map(function (t) { return box(t[0], t[1], t[2], t[3]); });

    // footer
    // one line at the foot (panel 4, 2026-10-14; there were two): what smallLine says, then these
    var foot = [E.daysText].concat(recs.lines);   // a year record is a sentence, not a day: it goes in the foot line
    if (E.cmp && E.ovNote) foot.push(E.ovNote);   // whenever the verdict says "usual" (2026-10-13)
    // the QR sits at the foot's line; a deep December bar under it moves it down to the small line (still inside the margin)
    var qrBottom = 1100, qb = qrBox(I.qr, X1, qrBottom);
    if (qb && barBoxes.some(function (bb) { return hit(bb, qb, 3); })) { qrBottom = 1132; qb = qrBox(I.qr, X1, qrBottom); }
    if (qb) room.add({ b: qb, own: 'qr', k: 'mark' });
    // the foot line is written last (the biggest rain or the dry stretch may land in it): its room, two lines' worth, is kept now
    var footRows = I.crop || I.temp || hasRib ? 3 : 1;   // the options' words can take the foot line to three lines
    room.add({ b: { x: ML, y: FOOT_Y - footRows * FOOT_GAP - 0.77 * 15, w: 1440, h: footRows * FOOT_GAP + 1.04 * 15 }, own: 'foot', k: 'text' });

    // remarkable days' rings on the ground line (placed first so every label keeps off them)
    var rings = recs.pts.map(function (r, k) { var x = xs(r.i); room.add({ b: { x: x - 5.5, y: G - 5.5, w: 11, h: 11 }, own: 'rec:' + k, k: 'mark' }); return x; });

    // ---- the reader's dates: words above the month row, a tick down to the ground (or the snow on it)
    // the reader's dates read clearly: upright, ink, 20 u (panel 4, 2026-10-14; were 17 u italic)
    var mst2 = { w: 500, size: 20, fill: C.ink }, LY = 290;
    var marks = E.markers.map(function (mk, k) { return { k: k, i: mk.i, x: xs(mk.i), label: mk.label }; });
    var placed = placeDates(marks, [LY, LY - 24, LY - 48], function (s) { return W(s, mst2); },
      function (it, b) { return b.y > 62 && room.free(b, 'mark:' + it.ids[0], false); },
      function (A, ba, ra, B, bb, rb) {
        if (hit(ba, bb, ra === rb ? 20 : 2)) return false;
        // a higher label's tick runs down past the lower rows: it may not cut a lower label
        var through = function (xsL, b) { return xsL.some(function (x) { return x > b.x - 4 && x < b.x + b.w + 4; }); };
        if (ra > rb && through(A.xs, bb)) return false;
        if (rb > ra && through(B.xs, ba)) return false;
        return true;
      }, [0.77 * 20, 0.27 * 20], [X0, X1]);
    var labelOf = {}, from = {};
    placed.forEach(function (pd) {
      pd.own = 'mark:' + pd.it.ids[0];
      room.text(box(pd.x, pd.y, pd.it.label, mst2), pd.own);
      labelOf[pd.it.ids[0]] = pd;
      pd.it.ids.forEach(function (id) { from[id] = pd.y + 6; });
    });
    marks.forEach(function (mk) {
      var x = mk.x, end = G - 1;
      if (E.full) days.forEach(function (dd, i) { if (Math.abs(i - mk.i) <= 1 && dd.s > 0 && E.P[i] !== null) end = Math.min(end, sy(dd.s) - 4); });
      if (rings.some(function (rx) { return Math.abs(rx - x) < 7.5; })) end = Math.min(end, G - 8);
      var segs2 = [[from[mk.k] === undefined ? LY + 6 : from[mk.k], end]];
      // around every month word and number it passes: 6 clear at the sides, 3 above, 10 below (so it never reads as hanging from a number)
      mBoxes.forEach(function (b) {
        if (!(x > b.x - 6 && x < b.x + b.w + 6)) return;
        var g0 = b.y - 3, g1 = b.y + b.h + 10;
        segs2 = segs2.reduce(function (acc, pq) {
          if (g1 <= pq[0] || g0 >= pq[1]) acc.push(pq);
          else [[pq[0], g0], [g1, pq[1]]].forEach(function (uv) { if (uv[1] - uv[0] > 8) acc.push(uv); });
          return acc;
        }, []);
      });
      mk.segs = segs2;
      segs2.forEach(function (pq) { room.seg(x, pq[0], x, pq[1], 0.75, 'mark:' + mk.k, 'lead'); });
    });

    // ---- frost marks and the crop on the ground line, the soil surface: plants grow up from it, clear of any snow there
    var inSnow = function (b) { return b.x > X0 && b.x + b.w < X1 && b.y > TY + 31 && b.y + b.h < G - 2; };
    var frost = frostLayer(I, { xs: xs, base: G, room: room, below: true, inPlot: function (b) { return b.x > X0 && b.x + b.w < X1 && b.y > TY + 31 && b.y + b.h < RB && !(b.y < G + 4 && b.y + b.h > G - 10); } });
    var crop = cropLayer(I, { xs: xs, base: G - 1, room: room, inPlot: inSnow, x0: X0, x1: X1, plantH: 42, avoid: marks.map(function (mk) { return mk.x; }).concat(frost.xs),
      blocked: function (a, b) { return snowBoxes.some(function (sb) { return sb.x < b + 2 && sb.x + sb.w > a - 2; }); } });

    // ---- the biggest rain, in red, in words, beside the foot of its bar
    var wetAt = null;
    if (E.wi >= 0) {
      var wst = { w: 500, size: 24, fill: C.accent };
      var wc = [{ x: wcx + 10, y: wy2 + 6, a: 'start', bare: true }, { x: wcx - 10, y: wy2 + 6, a: 'end', bare: true },
        { x: wcx + 10, y: wy2 - 6, a: 'start', bare: true }, { x: wcx - 10, y: wy2 - 6, a: 'end', bare: true }]
        .concat(spots(wcx, wy2 + 6, [], [10, 30, 70, 130]).filter(function (c) { return c.y > wy2 - 30; }));
      wetAt = choose(wc, function (c) {
        var b = box(c.x, c.y, E.wetText, Object.assign({}, wst, { anchor: c.a }));
        if (b.x < X0 || b.x + b.w > X1 || b.y < G + 8 || b.y + b.h > (hasRib ? RIB_Y - 6 : footRows > 1 ? 1040 : 1060)) return 0;
        c.b = b; c.L = null;
        if (!c.bare) {
          var sgn = c.a === 'start' ? 1 : -1;
          c.L = [wcx + 2.5 * sgn, wy2 - 2, c.x - 4 * sgn, b.y + b.h / 2];
          if (!room.clear(c.L, 'wet', 3)) return 0;
        }
        if (!room.free(b, 'wet', false)) return 0;
        return room.free(b, 'wet', true) ? 2 : 1;
      });
      if (wetAt) { room.text(wetAt.b, 'wet'); if (wetAt.L) room.seg(wetAt.L[0], wetAt.L[1], wetAt.L[2], wetAt.L[3], 1, 'wet', 'lead'); }
      else foot.push(plain(E.wetText));   // no clean spot under the ground: it is said in the footer
    }

    // ---- remarkable days: an open ring on the ground line, the label down in the open soil, clear of every bar
    var recAt = placeAll(recs.pts, function (k, at) {
      var r = recs.pts[k], x = rings[k], rst = { size: 16, w: 500, fill: C.rec }, own = 'rec:' + k;
      var top0 = E.P[r.i] > 0 && !(E.full && days[r.i].s > 0) ? ry(E.P[r.i]) + 4 : G + 5;
      var cands = [];
      /* A snow record tries the snow, above the ground, first: level with its pile
         and beside it (no leader), else over the pile on a short leader up from it. */
      if (/snow/i.test(r.label)) {
        var pileTop = E.full && days[r.i].s > 0 ? G - 2.2 - Math.max(1.4, G - sy(days[r.i].s)) : G - 6;
        var sup = [];
        for (var sy0 = G - 8; sy0 >= G - SH - 40; sy0 -= 12) sup.push({ x: x + 9, y: sy0, a: 'start', up: 'side' }, { x: x - 9, y: sy0, a: 'end', up: 'side' });
        // over the pile: centred, or (a long label with its date) reaching to one side, its leader still under its words
        for (var sy1 = pileTop - 10; sy1 >= G - SH - 40; sy1 -= 12) sup.push({ x: x, y: sy1, a: 'middle', up: 'over' }, { x: x + 24, y: sy1, a: 'end', up: 'over' }, { x: x - 24, y: sy1, a: 'start', up: 'over' });
        /* With its date a label can run too long to sit beside a tall pile: then the date goes on a second line
           under the words, same side, same gray (2026-10-15), before the label leaves the snow for the soil. */
        var two = splitDate(r.text), upTest = function (c) {
          var b = c.two ? twoBox(c.x, c.y, two, rst, c.a) : box(c.x, c.y, r.text, Object.assign({}, rst, { anchor: c.a }));
          if (b.x < X0 || b.x + b.w > X1 || b.y + b.h > G - 4) return 0;
          if (c.up === 'side') { if (b.y + b.h < pileTop) return 0; c.L = null; }
          else { c.L = [x, pileTop - 3, x, b.y + b.h + 3]; if (c.L[3] - c.L[1] > -4 || !room.clear([x, c.L[3], x, c.L[1]], own, 0)) return 0; }
          if (!room.free(b, own, false)) return 0;
          c.b = b;
          return room.free(b, own, true) ? 2 : 1;
        };
        var upPick = choose(sup, upTest) || (two ? choose(sup.map(function (c) { return Object.assign({}, c, { two: two }); }), upTest) : null);
        if (upPick) {
          var itsU = [room.text(upPick.b, own)];
          if (upPick.L) itsU.push(room.seg(x, upPick.L[3], x, upPick.L[1], 0.8, own, 'lead'));
          itsU.pick = upPick;
          return itsU;
        }
      }
      // beside its leader, or hanging under it (below the bars around it)
      for (var yy = G + 70; yy <= (hasRib ? RB + 10 : RB + 50); yy += 15) cands.push({ x: x + 8, y: yy, a: 'start' }, { x: x - 8, y: yy, a: 'end' }, { x: x, y: yy, a: 'middle' });
      // a label that spans another record's column would stand in its leader's way: only if nothing else fits
      var cols = rings.filter(function (rx, j) { return j !== k && !at[j]; });
      var spans = function (b) { return cols.some(function (rx) { return rx > b.x - 4 && rx < b.x + b.w + 4; }); };
      var test = function (open) { return function (c) {
        var b = box(c.x, c.y, r.text, Object.assign({}, rst, { anchor: c.a }));
        if (b.x < X0 || b.x + b.w > X1 || b.y < top0 + 6) return 0;
        if (!open && spans(b)) return 0;
        // the leader runs down the day's own column: it must not cut a bar or a word on the way
        c.L = [x, top0, x, c.a === 'middle' ? b.y - 3 : b.y + b.h / 2];
        if (!room.clear(c.L, own, 6)) return 0;   // 6: past the rings of the days beside it
        if (!room.free(b, own, false)) return 0;
        c.b = b;
        return room.free(b, own, true) ? 2 : 1;
      }; };
      var pick = choose(cands, test(false)) || choose(cands, test(true));
      if (!pick) return null;
      var its = [room.text(pick.b, own), room.seg(x, pick.L[1], x, pick.L[3], 0.8, own, 'lead')];
      its.pick = pick;
      return its;
    }, skipped, recs.pts.map(function (r, k) { return k; }).reverse());   // right to left: a label reaching right passes under the leaders it meets
    
    // ---- the dry stretch, under the ground, if it fits among the bars (after the remarkable days: they come first)
    var dryAt = null;
    if (E.dry) {
      var da = X0 + E.dry.s * w, db = X0 + (E.dry.e + 1) * w, dcx = (da + db) / 2;
      var ds = E.dry.len + (LOC.fr ? ' jours secs' : ' dry days'), dst = { it: true, size: 15, fill: C.mute, anchor: 'middle' };
      var dw = W(ds, dst), dc = [];
      for (var dd2 = 0; dd2 <= (db - da) / 2 + 4; dd2 += 6) [dcx - dd2, dcx + dd2].forEach(function (x) { if (x >= da && x <= db && dc.indexOf(x) < 0) dc.push(x); });
      [G + 30, G + 52].some(function (yy) {
        return dc.some(function (x) {
          var b = box(x, yy, ds, dst);
          if (b.x < X0 || b.x + b.w > X1 || x - dw / 2 < X0) return false;
          if (room.free(b, 'dry', true)) { dryAt = { x: x, y: yy, b: b }; return true; }
          return false;
        });
      });
      if (dryAt) room.text(dryAt.b, 'dry');
    }
    if (E.dry && !dryAt) foot.push(LOC.fr ? 'Plus longue période sèche : ' + E.dry.len + ' jours, ' + E.dry.range : 'Longest dry stretch: ' + E.dry.len + ' days, ' + E.dry.range);
    else if (E.dry) foot.push(LOC.fr ? E.dry.len + ' jours secs : ' + E.dry.range : E.dry.len + ' dry days: ' + E.dry.range);
    foot = foot.concat(frost.foot, cropFoot(I, crop.foot), (I.temp && I.temp.foot) || [], hasRib ? [ribbonFoot(I)] : []);
    var small = smallLine(E, ML, 1440, foot);

    // ================= draw, back to front
    o.push(G0('totals') + draw(totals) + G1);
    o.push(G0('title') + draw(title) + G1);
    if (lg) o.push(logoMark(lg));
    o.push(G0('axis'));
    R.ticks.forEach(function (t) { o.push(line(X0, ry(t), X1, ry(t), C.guide, 0.7)); });
    if (E.full) S.ticks.forEach(function (t) { o.push(line(X0, sy(t), X1, sy(t), C.snowGrid, 0.7)); });
    o.push(draw(axisT) + G1);
    o.push(G0('data'));
    if (snows) o.push('<g fill="' + C.snowFill + '" stroke="' + C.snowEdge + '" stroke-width="0.7">' + snows + '</g>');
    o.push('<g fill="' + C.bar + '">' + bars + '</g>' + G1);
    o.push(crop.back);
    if (hasRib) o.push(ribbon(I, { x0: X0, x1: X1, w: w, n: N, y0: RIB_Y, h: RIBBON_H, side: 'right' }));
    o.push(G0('axis'));
    ground.forEach(function (g) { o.push(line(g[0], G, g[1], G, C.ink, 1.1 * PT)); });
    mticks.forEach(function (x) { o.push(line(x, G - 7, x, G + 7, C.ink, 0.75 * PT)); });
    o.push(G1);
    if (prevX !== null) o.push(G0('data') + line(prevX, G - SH, prevX, RB, C.mute, 1, ' stroke-dasharray="3 4"') + G1);
    if (prevX !== null) E.laterBox = { x0: prevX, x1: X1, y0: G - SH, y1: RB };
    if (E.wi >= 0) {
      o.push(G0('wet') + '<rect x="' + n2(wcx - 1.9) + '" y="' + (G + 1.5) + '" width="3.8" height="' + n2(wy2 - G - 1.5) + '" fill="' + C.accent + '"/>');
      if (wetAt && wetAt.L) o.push('<path d="M' + n2(wetAt.L[0]) + ',' + n2(wetAt.L[1]) + 'L' + n2(wetAt.L[2]) + ',' + n2(wetAt.L[3]) + '" stroke="' + C.accent + '" stroke-width="1"/>');
      if (wetAt) o.push(T(wetAt.x, wetAt.y, E.wetText, Object.assign({}, wst, { anchor: wetAt.a })));
      o.push(G1);
    }
    if (dryAt) o.push(G0('dry') + T(dryAt.x, dryAt.y, ds, dst) + G1);
    o.push(frost.svg); o.push(crop.front);
    o.push(G0('months') + draw(months) + G1);
    marks.forEach(function (mk) {
      o.push(G0('mark:' + mk.k));
      mk.segs.forEach(function (pq) { o.push(line(mk.x, pq[0], mk.x, pq[1], C.ink, 0.75)); });
      var pd = labelOf[mk.k];
      if (pd) o.push(T(pd.x, pd.y, pd.it.label, Object.assign({ anchor: 'start' }, mst2)));
      o.push(G1);
    });
    recs.pts.forEach(function (r, k) {
      var pk = recAt[k];
      if (!pk) return;
      o.push(G0('rec:' + k) + (pk.L ? line(rings[k], pk.L[1], rings[k], pk.L[3], C.rec, 0.8, ' stroke-dasharray="2 2"') : ''));
      o.push('<circle cx="' + n2(rings[k]) + '" cy="' + G + '" r="4.6" fill="#FFFFFF" stroke="' + C.rec + '" stroke-width="1.8"/>');
      var rst2 = { size: 16, w: 500, fill: C.rec, anchor: pk.a };
      o.push((pk.two ? T(pk.x, pk.y, pk.two[0], rst2) + T(pk.x, pk.y + TWO_DY, pk.two[1], Object.assign(dateSt(rst2), { anchor: pk.a })) : T(pk.x, pk.y, r.text, rst2)) + G1);
    });
    if (small) o.push(small.svg);
    o.push(qrMark(I.qr, X1, qrBottom));
    last_skipped = skipped;
    last_logo = lg ? { x: lg.x, y: lg.y, w: lg.w, h: lg.h } : null;
    return close(I, E, o, bandAt(room, [(G + RB) / 2 + 40, G + (RB - G) * 0.3, G + (RB - G) * 0.8], G + 40, RB + 50, X0 - 6, X1 + 6, E.preview && E.n < N ? [X0 + E.n * w + 12, X1 + 6] : null));
  }

  /* Up to five marked days (Sig, 2026-10-15: "as long as everything still fits"). The first three are always
     drawn, as before. Past three, a set whose labels can only be drawn on top of each other (even merged into
     one) loses its last-added day, then the one before, until it fits; those days are not drawn at all, and
     lastUnplaced() names them (indexes into I.markers) so the page can tell the buyer. */
  var MAX_MARKS = 5, KEEP_MARKS = 3;
  var last_skipped = [], last_logo = null, last_forced = false, last_unplaced = [];
  function render(I) {
    measure = typeof I.measure === 'function' ? I.measure : defaultMeasure;
    setLoc(I.loc);
    var all = (I.markers || []).map(function (mk, k) { return { mk: mk, k: k }; }), n = (I.days || []).length;
    var live = all.filter(function (m) { return m.mk && m.mk.doy >= 0 && m.mk.doy < n; }).slice(0, MAX_MARKS), out = [], svg;
    for (;;) {
      last_skipped = []; last_logo = null; last_forced = false;
      var J = I.markers ? Object.assign({}, I, { markers: live.map(function (m) { return m.mk; }) }) : I;
      svg = J.style === 'r2' ? r2(J) : r1(J);
      if (!last_forced || live.length <= KEEP_MARKS) break;
      out.push(live.reduce(function (a, b) { return b.k > a.k ? b : a; }).k);
      live = live.filter(function (m) { return m.k !== out[out.length - 1]; });
    }
    last_unplaced = out.sort(function (a, b) { return a - b; });
    return svg;
  }

  /* What the print says, in words, for the letter that goes in the box with it
     (components/rp-insert.js, 2026-10-17). Read from the same model the print
     is drawn from, with the same rules for what is on the sheet: the dry
     stretch only where this style marks it, the usual year only when there is
     one, the reader's days minus any the last render left off (pass
     opts.unplaced, AgRainArt.lastUnplaced() after render(I)). Nothing here is
     worked out a second way. Amounts come as the print writes them. */
  function facts(I, opts) {
    opts = opts || {};
    setLoc(I.loc);
    var E = model(I), style = I.style === 'r2' ? 'r2' : 'r1', days = E.days, off = opts.unplaced || [];
    var dryOn = !!(E.dry && (style === 'r2' || E.dry.len >= printDryMin(I)));
    var marks = (I.markers || []).map(function (mk, k) { return { mk: mk, k: k }; })
      .filter(function (m) { return off.indexOf(m.k) < 0 && m.mk && m.mk.doy >= 0 && m.mk.doy < E.n; }).slice(0, MAX_MARKS)
      .map(function (m) {
        var dt = days[m.mk.doy] && days[m.mk.doy].date, f = dt ? fmtDate(dt) : '', lb = String(m.mk.label || '').replace(/[\u0001\u0002]/g, '');
        return { date: dt, dateText: f, words: lb && lb !== f ? lb : '' };
      }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return {
      style: style, year: E.year, place: E.place, name: E.name, dedication: E.dedication, preview: !!E.preview,
      total: E.total, totalText: E.TU, liquid: E.liquid,
      snowState: E.snowState, snowNote: E.snowNote,
      snowText: E.full ? (LOC.mm ? snowAmt(E.snowRaw) : E.snowTot.toFixed(1) + ' in') : null,
      wet: E.wet ? { label: E.wetLabel, amount: rainAmt(E.wet.p, 'day'), date: E.wet.date, dateText: fmtDate(E.wet.date) } : null,
      wetDays: I.D.wet, daysLabel: tr(E.snowState === 'none' ? 'Days with rain' : 'Days with rain or snow'),
      verdict: E.verdict, usual: E.cmp ? rainAmt(E.normalRec, 'tot') : null, usualNote: E.cmp ? E.ovNote : '', normals: E.showN,
      dry: dryOn ? { len: E.dry.len, from: days[E.dry.s].date, to: days[E.dry.e].date, range: E.dry.range } : null,
      markers: marks, gaps: E.gaps, missing: E.missing, units: LOC.mm ? 'mm' : 'in'
    };
  }

  root.AgRainArt = {
    render: render, model: model, facts: facts,
    // the print's colors and its QR ink, for the letter's key (rp-insert.js)
    COLORS: Object.assign({}, C), SERIAL_INK: SERIAL_INK, SANS: SANS, SERIF: SERIF, recordPoints: recordPoints, plain: plain, lastSkipped: function () { return last_skipped.slice(); },
    // marked days (indexes into the input's markers) the last render left off because they could not fit cleanly
    lastUnplaced: function () { return last_unplaced.slice(); }, MAX_MARKS: MAX_MARKS,
    // the buyer's logo: its size for a shape (w / h) in a style, and where the last render put it (art units)
    logoSize: logoSize, lastLogo: function () { return last_logo ? Object.assign({}, last_logo) : null; },
    STYLES: ['r1', 'r2'], W: W0, H: H0, QR_INK: QR_INK, INK: C.ink, roughW: roughW,
    // the French words on the print, for the review list and the tests (FR-REVIEW)
    FR: FR, MON_FR: MON_FR
  };
})(typeof window !== 'undefined' ? window : this);
