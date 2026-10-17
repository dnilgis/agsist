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
  function dateSt(o) { o = st(o || {}); return Object.assign({}, o, { size: o.size >= 21 ? 17 : 16, w: 400, fill: C.mute, it: false, ls: 0 }); }
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
    var ys = lines.length === 1 ? [FOOT_Y] : [FOOT_Y - FOOT_GAP, FOOT_Y], svg = '', boxes = [];
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

  // ======================================================================= R1
  // line weights that read across a room (panel 4, 2026-10-14; were 3.4 and 1.6)
  var STAIR_W = 4.6, USUAL_W = 2.2;
  /* A dry stretch is marked on the print from this many days (panel 4, 2026-10-14). The engine's showDry
     (7 days) still decides whether there is one at all; the page may pass input.printDryMin to change this. */
  var PRINT_DRY_MIN = 14;
  function printDryMin(I) { var v = +I.printDryMin; return v > 0 && isFinite(v) ? v : PRINT_DRY_MIN; }
  // wetHead: the biggest rain found no clean spot on the chart, so it is a line in the header, in red
  function r1(I, wetHead) {
    var E = model(I), N = E.N, days = E.days, skipped = [];
    var ML = 120, X0 = 196, X1 = 1680, PW = X1 - X0, w = PW / N;
    var showN = E.showN;
    // the chart starts just under the safe margin's top band and the name block gets the room at the foot (panel 4, 2026-10-14)
    var PTOP = 92, PB = showN ? 742 : 790;
    var xs = function (i) { return X0 + i * w; };
    var lastCum = function (i) { for (var k = i; k >= 0; k--) if (E.cum[k] !== null) return E.cum[k]; return 0; };
    var recs = recordPoints(E, I.records);
    var room = new Room(), o = [open(I, E)];
    // month names tucked under the axis, so they belong to the chart; the dates' row (when a date can't sit on the line) under them
    var MY = PB + 42, RY = MY + (showN ? 80 : 34);

    /* ---- the title block, bottom left (panel 4, 2026-10-14). With a name, the name is the biggest words on the
       sheet (78 u, shrinking to fit), the place and year on one line under it, the buyer's line under that.
       With no name, the place at 50 u over the year at 100 u. A logo goes first, at the left margin, centred
       on the block, and the words start after it (TX). */
    var title = [], lg = logoOf(I, 'r1'), TX = lg ? ML + lg.w + LOGO_GAP : ML;
    // what "usual" means, wherever the print says "a usual year": a footnote, so it is in the foot line, not the header (panel 4)
    var small = smallLine(E, ML, 1500, [E.cmp && E.ovNote ? E.ovNote : '']);
    var lift = small && small.lines > 1 ? FOOT_GAP : 0;
    if (small) small.boxes.forEach(function (b) { room.text(b, 'foot'); });
    var lockW = 1530 - TX, lockTop, lockBase;
    var dedSt = function (maxW) { return { fam: SERIF, it: true, w: 400, size: fit(E.dedication, { fam: SERIF, it: true, w: 400, size: 25 }, maxW, 14), fill: C.mute }; };
    if (E.name) {
      var nameSt = { fam: SERIF, w: 500, size: fit(E.name, { fam: SERIF, w: 500, size: 78 }, lockW, 40) };
      var nY = E.dedication ? 1006 : 1022, pyY = nY + 50;
      title.push([TX - 2, nY, E.name, nameSt]);
      // place and year at 34 u: always smaller than the name, whatever its length
      var pyS = { fam: SERIF, w: 400, size: 34 }, yyS = { fam: SERIF, w: 600, size: 34 }, yw = W(String(E.year), yyS) + 18;
      pyS.size = yyS.size = Math.min(34, nameSt.size - 8, fit(E.place, pyS, lockW - yw, 22));
      title.push([TX, pyY, E.place, pyS]);
      title.push([TX + W(E.place, pyS) + 18, pyY, String(E.year), yyS]);
      if (E.dedication) title.push([TX, pyY + 36, E.dedication, dedSt(lockW)]);
      lockTop = nY - asc(E.name) * nameSt.size; lockBase = pyY;
    } else {
      var placeSt = { fam: SERIF, w: 400, size: fit(E.place, { fam: SERIF, w: 400, size: 50 }, lockW, 24) }, yearSt = { fam: SERIF, w: 600, size: 100 };
      title.push([TX, 994, E.place, placeSt]);
      title.push([TX - 4, 1090, String(E.year), yearSt]);
      var dx = TX + W(String(E.year), yearSt) + 28;
      if (E.dedication) title.push([dx, 1086, E.dedication, dedSt(1530 - dx)]);
      lockTop = 994 - asc(E.place) * placeSt.size; lockBase = 1090;
    }
    // a foot line that took two lines lifts the block by one
    if (lift) { title.forEach(function (t) { t[1] -= lift; }); lockTop -= lift; lockBase -= lift; }
    title.forEach(function (t) { room.text(box(t[0], t[1], t[2], t[3]), 'title'); });
    if (lg) {
      lg.x = ML; lg.y = n2((lockTop + lockBase) / 2 - lg.h / 2);
      room.add({ b: { x: lg.x, y: lg.y, w: lg.w, h: lg.h }, own: 'logo', k: 'mark' });
    }
    var qb = qrBox(I.qr, 1690, 1100);
    if (qb) room.add({ b: qb, own: 'qr', k: 'mark' });

    // ---- month labels, and with normals on, each month's total over its normal
    var months = [];
    E.starts.forEach(function (b, m) {
      var cx = (xs(b) + xs(E.ends[m])) / 2;
      months.push([cx, MY, monCap(m), { w: 500, size: 17, ls: 0.16, fill: C.ink, anchor: 'middle' }]);
      if (showN && E.monthHas[m]) {
        months.push([cx, MY + 26, rainNum(E.month[m], 'tot') + (m === 0 ? ' ' + rU() : ''), { w: 500, size: 19, fill: C.rain, anchor: 'middle' }]);
        months.push([cx, MY + 48, (m === 0 ? tr('usual') + ' ' : '') + rainNum(E.mN[m], 'tot'), { size: 15, fill: C.mute, anchor: 'middle' }]);
      }
    });
    months.forEach(function (t) { room.text(box(t[0], t[1], t[2], t[3]), 'months'); });
    room.seg(X0, PB, X1, PB, 0.9 * PT, 'axis', 'axis');
    E.starts.concat([isLeap(E.year) ? 366 : 365]).forEach(function (b) { if (b <= N) room.seg(xs(b), PB, xs(b), PB + 8, 0.75 * PT, 'axis', 'axis'); });

    // snow is drawn above the line only (Sig, 2026-10-13): its steps on the staircase, in ice blue; nothing under the axis

    /* ---- the dry stretch: a bracket under the months, its words under it. On the print a week without rain is
       not news in most of the country: it is marked from printDryMin days (14 unless the page asks otherwise;
       panel 4, 2026-10-14). The page's own stats keep the engine's rule. */
    var dry = null, extraLines = [];
    if (E.dry && E.dry.len >= printDryMin(I)) {
      var da = xs(E.dry.s), db = xs(E.dry.e + 1);
      dry = { a: da, b: db, text: E.dry.len + (LOC.fr ? ' jours secs' : ' dry days'), st: { size: 17, fill: C.mute, it: true } };
      room.seg(da, RY - 24, da, RY - 18, 0.9, 'dry', 'lead'); room.seg(da, RY - 18, db, RY - 18, 0.9, 'dry', 'lead'); room.seg(db, RY - 24, db, RY - 18, 0.9, 'dry', 'lead');
    }

    // ---- the reader's dates: a dot on the line and a drop line to the axis; the words go on the line beside the dot (placed below)
    var mst = { size: 21, w: 500, fill: C.ink };
    var marks = E.markers.map(function (mk, k) { return { k: k, i: mk.i, x: xs(mk.i + 0.5), label: mk.label }; });
    var dateRows = [RY, RY + 26, RY + 52];
    var placedDates = [], labelOf = {};
    // ---- the header: verdict and the small facts, upper left inside the plot (the early year sits low there)
    var head = E.verdict || (LOC.fr ? E.TU + ' de ' : LOC.mm ? E.TU + ' of ' : E.T + ' inches of ') + E.liquid + E.soFar;
    var facts = [];
    if (E.snowText) facts.push(E.snowText + ' (' + E.snowKey + ')');
    facts.push(E.daysText);
    // what "usual" means is in the foot line (panel 4, 2026-10-14)
    var factLine = facts.join('  ·  ');
    // the headline stays under the name, whatever the name's length (the name is the biggest words on the sheet)
    var hs = { fam: SERIF, w: 600, size: E.name ? Math.min(52, nameSt.size - 4) : 52 }, fs = { size: 21, fill: C.mute };
    var yN = { fam: SERIF, w: 600, size: 40, fill: C.rain }, yL = { size: 19, w: 500, fill: C.rain };
    var uN = { fam: SERIF, w: 400, size: 32, fill: C.mute }, uL = { size: 19, fill: C.mute };
    var lineSt = { size: 19, w: 500, fill: C.rec };
    var yLab = tr(E.full ? 'your year, rain and melted snow' : E.snowState === 'none' ? 'your year, rain' : 'your year') + E.soFar;
    var uLab = tr(E.preview ? 'a usual year by then' : E.unrecorded ? 'a usual year, same days' : 'a usual year');
    var nU = E.cmp ? rainAmt(E.normalRec, 'tot') : '';
    // the key row keys two lines; with nothing to compare, the headline already says the total, so it goes (no total said twice)
    var keyW = E.cmp ? 46 + W(E.TU, yN) + 10 + W(yLab, yL) + 40 + 46 + W(nU, uN) + 10 + W(uLab, uL) : 0;
    var hLines = recs.lines.concat(extraLines).concat(wetHead ? [E.wetText] : []);
    var hw = Math.max(W(head, hs), W(factLine, fs), keyW, Math.max.apply(null, [0].concat(hLines.map(function (t) { return W(t, lineSt); }))));
    var keyH = E.cmp ? 62 : 6;   // facts baseline: 102 under the headline with the key row, 46 without
    var hh = 62 + keyH + 56 + (hLines.length ? 28 + (hLines.length - 1) * 28 : 0) + 4;
    function header(HX, TOP) {
      var HY = TOP + 62, KY = HY + keyH, kx = HX, p = [T(HX, HY, head, hs)];
      if (E.cmp) {
        p.push(line(kx, KY - 12, kx + 34, KY - 12, C.rain, 4.6)); kx += 46;
        p.push(T(kx, KY, E.TU, yN)); kx += W(E.TU, yN) + 10;
        p.push(T(kx, KY, yLab, yL)); kx += W(yLab, yL);
        kx += 40;
        p.push('<path d="M' + n2(kx) + ',' + (KY - 12) + 'h34" stroke="' + C.mute + '" stroke-width="2.2" stroke-dasharray="9 6"/>'); kx += 46;
        p.push(T(kx, KY, nU, uN)); kx += W(nU, uN) + 10;
        p.push(T(kx, KY, uLab, uL));
      }
      p.push(T(HX, KY + 40, factLine, fs));
      hLines.forEach(function (t, k) { p.push(T(HX, KY + 70 + k * 28, t, wetHead && t === E.wetText ? Object.assign({}, lineSt, { fill: C.accent }) : lineSt)); });
      return p.join('');
    }

    // ---- the scale, and where the header can sit without the year's lines running through it
    var top = Math.max(E.total, E.cmp ? E.normalRec : 0, 1);
    /* metric: the steps are picked in mm (a round 50, 100 or 200 mm), then worked in inches like the rest */
    var K = LOC.mm ? MM : 1, topK = top * K;
    var stepK = LOC.mm ? (topK > 2000 ? 500 : topK > 1000 ? 200 : topK > 400 ? 100 : topK > 150 ? 50 : topK > 60 ? 20 : 10) : (top > 50 ? 10 : top > 12 ? 5 : top > 5 ? 2 : 1);
    var step = stepK / K;
    var dom0 = Math.ceil(topK / stepK - 1e-6) * stepK / K;
    function geom(dom) {
      var y = function (v) { return PB - v * (PB - PTOP) / dom; }, segs = [], prev = 0, pen = false;
      var addH = function (x1, x2, yy) { var L = segs[segs.length - 1]; if (L && L[1] === yy && L[3] === yy && Math.abs(L[2] - x1) < 1e-6) L[2] = x2; else segs.push([x1, yy, x2, yy]); };
      days.forEach(function (x, i) {
        if (E.P[i] === null) { pen = false; return; }
        var c = E.cum[i];
        if (!pen || c !== prev) segs.push([xs(i), y(prev), xs(i), y(c)]);
        pen = true;
        addH(xs(i), xs(i + 1), y(c));
        prev = c;
      });
      var nseg = [];
      if (E.cmp) { var px = X0, py = PB; days.forEach(function (x, i) { var qx = xs(i + 1), qy = y(E.ncum[i]); nseg.push([px, py, qx, qy]); px = qx; py = qy; }); }
      var dots = marks.map(function (mk) { return { x: mk.x, y: y(lastCum(mk.i)) }; });
      var rings = recs.pts.map(function (r) { return { x: xs(r.i + 0.5), y: y(lastCum(r.i)) }; });
      return { dom: dom, y: y, stair: segs, ncum: nseg, dots: dots, rings: rings };
    }
    function headClear(g, b) {
      var bad = function (s) { return segRect(s, b, 8); };
      if (g.stair.some(bad) || g.ncum.some(bad)) return false;
      if (g.dots.some(function (d) { return segRect([d.x, d.y, d.x, PB], b, 8); })) return false;
      if (g.rings.some(function (d) { return hit({ x: d.x - 6, y: d.y - 6, w: 12, h: 12 }, b, 6); })) return false;
      return true;
    }
    var UL = { x: X0 + 28, top: PTOP }, LR = { x: X1 - 14 - hw, top: PB - 14 - hh + 4 };
    var hbox = function (p) { return { x: p.x - 14, y: p.top - 4, w: hw + 28, h: hh }; };
    var g = null, hp = null;
    // upper left (Sig's rule), with room made above the line if it takes a little; then lower right; then as much room as it takes
    for (var dm = dom0; dm <= dom0 * 1.5 + 1e-9 && !hp; dm += step) { var g1 = geom(dm); if (headClear(g1, hbox(UL))) { g = g1; hp = UL; } }
    if (!hp && LR.x > X0 + 40) { var g2 = geom(dom0); if (headClear(g2, hbox(LR))) { g = g2; hp = LR; } }
    for (var dm2 = dom0 * 1.5 + step; !hp && dm2 <= dom0 * 6; dm2 += step) { var g3 = geom(dm2); if (headClear(g3, hbox(UL))) { g = g3; hp = UL; } }
    if (!hp) { g = geom(dom0); hp = UL; }
    var dom = g.dom, y = g.y, headBox = hbox(hp);
    room.add({ b: headBox, own: 'head', k: 'mark' });

    /* ---- everything the scale puts on the sheet, into the room. A gridline the
       header box covers where it leaves the axis has no number either (a number
       beside the headline reads as part of it); the unit goes on the highest
       number still drawn. */
    var tickVals = [];
    for (var v = 0; v <= dom + 1e-9; v += step) {
      var gy = y(v);
      if (v > 0 && headBox.x < X0 + 40 && gy >= headBox.y - 8 && gy <= headBox.y + headBox.h + 8) continue;
      tickVals.push(v);
    }
    var topTick = tickVals[tickVals.length - 1];
    var tickNum = function (v) { return LOC.mm ? num(Math.round(v * MM), 0) : String(+v.toFixed(6)); };
    var tickText = function (v) { return v === topTick && (v > 0 || tickVals.length === 1) ? tickNum(v) + ' ' + rU() : tickNum(v); };
    for (v = 0; v <= dom + 1e-9; v += step) if (v > 0) room.seg(X0, y(v), X1, y(v), 0.7, 'axis', 'soft');
    tickVals.forEach(function (v) { room.text(box(X0 - 14, y(v) + 5, tickText(v), { size: 15, anchor: 'end' }), 'axis'); });
    g.stair.forEach(function (s) { room.add({ s: s, sw: STAIR_W, own: 'data', k: 'data' }); });
    g.ncum.forEach(function (s) { room.add({ s: s, sw: USUAL_W, own: 'data', k: 'usual' }); });
    // the preview's "so far" line stops under the header rather than run through it
    var pvTop = E.preview && E.n < N && xs(E.n) > headBox.x - 6 && xs(E.n) < headBox.x + headBox.w + 6 ? headBox.y + headBox.h + 6 : PTOP;
    if (E.preview && E.n < N) room.seg(xs(E.n), pvTop, xs(E.n), PB, 1, 'data', 'usual');
    var wx = -1, wc0 = 0, wc1 = 0;
    if (E.wi >= 0) { wx = xs(E.wi); wc1 = E.cum[E.wi]; wc0 = wc1 - E.wet.p; room.seg(wx, y(wc0), wx, y(wc1), 4.4, 'wet', 'data'); }
    var ringAt = g.rings;
    ringAt.forEach(function (rg, k) { room.add({ b: { x: rg.x - 6, y: rg.y - 6, w: 12, h: 12 }, own: 'rec:' + k, k: 'mark' }); });
    // each date's dot, and its drop line from under the dot (and under any ring beside it) to the axis
    marks.forEach(function (mk, k) {
      mk.y = g.dots[k].y; mk.y0 = mk.y + 5;
      // under its own dot, and under any dot or ring beside it (dates a day or two apart sit almost on each other)
      for (var pass = 0; pass < 3; pass++) {
        g.dots.forEach(function (d, j) { if (j !== k && Math.abs(d.x - mk.x) < 7 && d.y + 6.5 > mk.y0) mk.y0 = d.y + 7; });
        ringAt.forEach(function (rg) { if (Math.abs(rg.x - mk.x) < 7.5 && rg.y + 7 > mk.y0) mk.y0 = rg.y + 7.5; });
      }
      room.add({ b: { x: mk.x - 5.3, y: mk.y - 5.3, w: 10.6, h: 10.6 }, own: 'mark:' + k, k: 'mark' });
      if (mk.y0 < PB) room.seg(mk.x, mk.y0, mk.x, PB, 0.75, 'mark:' + k, 'lead');
    });
    var inPlot = function (b) { return b.x > X0 + 4 && b.x + b.w < X1 && b.y + b.h < PB - 6 && b.y > PTOP - 20; };

    // ---- the biggest rain, in words, close to its red riser
    var wetAt = null;
    if (E.wi >= 0 && !wetHead) {
      var wst = { w: 500, size: 23, fill: C.accent }, wmy = (y(wc0) + y(wc1)) / 2, s = E.wetText;
      var wc = [];
      [34, 64, 94, 124, 154].forEach(function (dy) { wc.push({ x: wx + 16, y: y(wc0) + dy, a: 'start' }); });
      [-24, -54, -84].forEach(function (dy) { wc.push({ x: wx - 16, y: y(wc1) + dy, a: 'end' }); });
      [34, 64, 94].forEach(function (dy) { wc.push({ x: wx - 16, y: y(wc0) + dy, a: 'end' }); });
      wc = wc.concat(spots(wx, wmy, [], [16, 50, 100, 170]).map(function (c) { return c; }));
      wetAt = choose(wc, function (c) {
        var b = box(c.x, c.y, s, Object.assign({}, wst, { anchor: c.a }));
        if (!inPlot(b)) return 0;
        if (!room.free(b, 'wet', false)) return 0;
        // the leader leaves the riser from its side, or from its top or foot (a date's drop line may run beside it)
        var sgn = c.a === 'start' ? 1 : -1, ey = b.y + b.h / 2, ex = c.x - 4 * sgn;
        var L = [[wx + 4 * sgn, wmy], [wx, y(wc1) - 7], [wx, y(wc0) + 7]].map(function (p) { return [p[0], p[1], ex, ey]; })
          // and never through a remarkable day's ring or a reader's dot (either can sit at the top of the riser, the same day)
          .filter(function (l) { return sgn * (l[2] - l[0]) >= 0 && room.clear(l, 'wet', 2) && !ringAt.concat(g.dots).some(function (rg) { return segRect(l, { x: rg.x - 6, y: rg.y - 6, w: 12, h: 12 }, 1); }); })[0];
        if (!L) return 0;
        c.b = b; c.L = L;
        return room.free(b, 'wet', true) ? 2 : 1;
      });
      if (wetAt) { room.text(wetAt.b, 'wet'); room.seg(wetAt.L[0], wetAt.L[1], wetAt.L[2], wetAt.L[3], 1, 'wet', 'lead'); }
      else return r1(I, true);
    }

    /* ---- the reader's dates, on the line (panel 4, 2026-10-14: a marked day is the second thing the eye
       finds after the name). The words sit beside the dot in ink at 21 u, before the remarkable days take
       their spots; a date with no clean spot on the chart goes in a row under the months, never dropped. */
    var rowMarks = [];
    marks.forEach(function (mk, k) {
      if (!mk.label) return;
      var own = 'mark:' + k;
      var first = [[14, -16, 'start'], [-14, -16, 'end'], [14, 34, 'start'], [-14, 34, 'end'], [16, -44, 'start'], [-16, -44, 'end'], [16, 62, 'start'], [-16, 62, 'end']];
      var pick = choose(spots(mk.x, mk.y, first, [14, 40, 80, 130]), function (c) {
        var b = box(c.x, c.y, mk.label, Object.assign({}, mst, { anchor: c.a }));
        if (!inPlot(b)) return 0;
        var L = [mk.x, mk.y, c.x + (c.a === 'start' ? -3 : 3), b.y + b.h / 2];
        // close to its dot: a word far from its date reads as someone else's
        if (Math.hypot(L[2] - L[0], L[3] - L[1]) > 150) return 0;
        if (!room.clear(L, own, 7)) return 0;
        if (!room.free(b, own, false)) return 0;
        c.b = b; c.L = L;
        return room.free(b, own, true) ? 2 : 1;
      });
      if (!pick) { rowMarks.push(mk); return; }
      room.text(pick.b, own);
      if (Math.hypot(pick.L[2] - pick.L[0], pick.L[3] - pick.L[1]) > 16) room.seg(pick.L[0], pick.L[1], pick.L[2], pick.L[3], 0.9, own, 'lead');
      else pick.L = null;
      labelOf[k] = { line: true, x: pick.x, y: pick.y, a: pick.a, L: pick.L, it: { label: mk.label } };
    });
    // the rest in a row under the months, over a tick under the axis
    if (rowMarks.length) {
      var rowSt = Object.assign({}, mst, { size: 19 });
      placedDates = placeDates(rowMarks, dateRows, function (s) { return W(s, rowSt); },
        function (it, b) { return b.y + b.h < (small ? small.box.y - 6 : 1138) && room.free(b, 'mark:' + it.ids[0], false); },
        function (A, ba, ra, B, bb, rb) { return !hit(ba, bb, ra === rb ? 20 : 2); }, [0.77 * 19, 0.27 * 19], [ML, 1738]);   // 20 apart along a row; rows may stack
      placedDates.forEach(function (pd) {
        pd.own = 'mark:' + pd.it.ids[0];
        pd.box = box(pd.x, pd.y, pd.it.label, rowSt);
        pd.st = rowSt;
        room.text(pd.box, pd.own);
        pd.it.ids.forEach(function (id) { marks[id].tick = true; room.seg(marks[id].x, PB + 8, marks[id].x, PB + 14, 0.75, 'mark:' + id, 'lead'); });
        labelOf[pd.it.ids[0]] = pd;
      });
    }

    // the dry stretch's words: under the bracket, in a row with room; if none, a line in the header
    if (dry) {
      // its words centered somewhere over the bracket, nearest the middle first
      var dw = W(dry.text, dry.st), dsol = null;
      var dcx = (dry.a + dry.b) / 2, dlo = Math.max(62, dry.a - dw / 2), dhi = Math.min(1738 - dw, dry.b - dw / 2);
      var dc = [];
      for (var dd = 0; dd <= Math.max(0, dhi - dlo) + 4; dd += 4) [dcx - dw / 2 - dd, dcx - dw / 2 + dd].forEach(function (x) { if (x >= dlo - 1e-9 && x <= dhi + 1e-9) dc.push(x); });
      if (!dc.length) dc.push(Math.max(62, Math.min(1738 - dw, dcx - dw / 2)));
      [RY, RY + 24].some(function (ry) {
        return dc.some(function (x) {
          var b = box(x, ry, dry.text, dry.st);
          // a clear gap from the dates' words, so the row never reads as one phrase
          if (b.y + b.h < (small ? small.box.y - 6 : 1138) && room.free(b, 'dry', false) && !placedDates.some(function (pd) { return hit(pd.box, b, 24); })) { dsol = { x: x, y: ry, b: b }; return true; }
          return false;
        });
      });
      if (dsol) { dry.at = dsol; room.text(dsol.b, 'dry'); }
      else { extraLines.push(LOC.fr ? 'Plus longue période sèche : ' + E.dry.len + ' jours, ' + E.dry.range : 'Longest dry stretch: ' + E.dry.len + ' days, ' + E.dry.range); dry.at = null; }
    }

    // ---- remarkable days: a small open ring on the line, a label clear of everything
    var recAt = placeAll(recs.pts, function (k) {
      var r = recs.pts[k], rg = ringAt[k], rst = { size: 16, w: 500, fill: C.rec }, own = 'rec:' + k;
      var first = [[14, 30, 'start'], [-14, -18, 'end'], [14, 58, 'start'], [-14, -46, 'end'], [14, 86, 'start'], [-14, 30, 'end'], [14, -18, 'start'], [-14, -74, 'end'], [14, 114, 'start'], [-14, 58, 'end']];
      var pick = choose(spots(rg.x, rg.y, first, [14, 44, 90, 150]), function (c) {
        var b = box(c.x, c.y, r.text, Object.assign({}, rst, { anchor: c.a }));
        if (!inPlot(b)) return 0;
        var L = [rg.x, rg.y, c.x + (c.a === 'start' ? -3 : 3), b.y + b.h / 2];
        if (!room.clear(L, own, 8)) return 0;
        if (!room.free(b, own, false)) return 0;
        c.b = b; c.L = L;
        return room.free(b, own, true) ? 2 : 1;
      });
      if (!pick) return null;
      var its = [room.text(pick.b, own), room.seg(pick.L[0], pick.L[1], pick.L[2], pick.L[3], 0.8, own, 'lead')];
      its.pick = pick;
      return its;
    }, skipped);
    
    // ================= draw, back to front
    o.push(G0('axis'));
    // a gridline at the header's height starts at the header box's right edge: no stub left of it
    for (var v2 = 0; v2 <= dom + 1e-9; v2 += step) if (v2 > 0) {
      var gy2 = y(v2), under = headBox.x < X0 + 40 && gy2 >= headBox.y - 2 && gy2 <= headBox.y + headBox.h + 2;
      o.push(line(under ? headBox.x + headBox.w : X0, gy2, X1, gy2, C.grid, 0.7));
    }
    tickVals.forEach(function (v3) { o.push(T(X0 - 14, y(v3) + 5, tickText(v3), { size: 15, fill: C.mute, anchor: 'end' })); });
    o.push(G1);
    o.push(G0('head') + '<rect x="' + n2(headBox.x) + '" y="' + n2(headBox.y) + '" width="' + n2(headBox.w) + '" height="' + n2(headBox.h) + '" fill="#FFFFFF"/>');
    o.push(header(hp.x, hp.top) + G1);

    // the band between the year and a usual year
    if (E.cmp) {
      var band = '', last = 0;
      days.forEach(function (x, i) {
        if (E.cum[i] !== null) last = E.cum[i];
        var a = y(last), b = y(E.ncum[i]);
        if (Math.abs(a - b) < 0.3) return;
        band += '<rect x="' + n2(xs(i)) + '" y="' + n2(Math.min(a, b)) + '" width="' + n2(w + 0.25) + '" height="' + n2(Math.abs(a - b)) + '" fill="' + (a > b ? C.dryBand : C.wetBand) + '"/>';
      });
      o.push(G0('data') + '<g shape-rendering="crispEdges">' + band + '</g>');
      var p = 'M' + X0 + ',' + PB;
      days.forEach(function (x, i) { p += 'L' + n2(xs(i + 1)) + ',' + n2(y(E.ncum[i])); });
      o.push('<path d="' + p + '" fill="none" stroke="' + C.mute + '" stroke-width="' + USUAL_W + '" stroke-dasharray="9 6"/>' + G1);
    }

    // axis and month ticks
    o.push(G0('axis') + line(X0, PB, X1, PB, C.ink, 0.9 * PT));
    E.starts.concat([isLeap(E.year) ? 366 : 365]).forEach(function (b) { if (b <= N) o.push(line(xs(b), PB, xs(b), PB + 8, C.ink, 0.75 * PT)); });
    o.push(G1);
    if (E.preview && E.n < N) o.push(G0('data') + line(xs(E.n), pvTop, xs(E.n), PB, C.mute, 1, ' stroke-dasharray="3 4"') + G1);
    if (E.preview && E.n < N) E.laterBox = { x0: xs(E.n), x1: X1, y0: pvTop, y1: PB };

    // the staircase; the pen lifts over a day with no amount of its own
    var d1 = '', prev = 0, pen = false;
    days.forEach(function (x, i) {
      if (E.P[i] === null) { pen = false; return; }
      var c = E.cum[i];
      if (!pen) { d1 += 'M' + n2(xs(i)) + ',' + n2(y(prev)); pen = true; }
      d1 += 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(i + 1)) + ',' + n2(y(c));
      prev = c;
    });
    o.push(G0('data'));
    if (d1) o.push('<path d="' + d1 + '" fill="none" stroke="' + C.rain + '" stroke-width="' + STAIR_W + '" stroke-linejoin="round" stroke-linecap="butt"/>');
    // steps that came as snow, in ice blue: the riser and the flat after it, up to the next wet day or gap
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
    if (E.wi >= 0) o.push(G0('wet') + line(wx, y(wc0) + 1.5, wx, y(wc1) - 1.5, C.accent, 4.4) + G1);
    o.push(G0('months') + months.map(function (t) { return T(t[0], t[1], t[2], t[3]); }).join('') + G1);
    if (dry && dry.at) {
      o.push(G0('dry') + '<path d="M' + n2(dry.a) + ',' + (RY - 24) + 'v6H' + n2(dry.b) + 'v-6" fill="none" stroke="' + C.mute + '" stroke-width="0.9"/>');
      o.push(T(dry.at.x, dry.at.y, dry.text, dry.st) + G1);
    }
    // the biggest rain's words
    if (wetAt) o.push(G0('wet') + '<path d="M' + n2(wetAt.L[0]) + ',' + n2(wetAt.L[1]) + 'L' + n2(wetAt.L[2]) + ',' + n2(wetAt.L[3]) + '" stroke="' + C.accent + '" stroke-width="1"/>' +
      T(wetAt.x, wetAt.y, E.wetText, { w: 500, size: 23, fill: C.accent, anchor: wetAt.a }) + G1);
    // remarkable days (under the reader's dots: a date on the same day keeps its dot on top)
    recs.pts.forEach(function (r, k) {
      var pk = recAt[k], rg = ringAt[k];
      if (!pk) return;
      o.push(G0('rec:' + k) + '<circle cx="' + n2(rg.x) + '" cy="' + n2(rg.y) + '" r="5" fill="#FFFFFF" stroke="' + C.rec + '" stroke-width="1.8"/>');
      o.push('<path d="M' + n2(pk.L[0]) + ',' + n2(pk.L[1]) + 'L' + n2(pk.L[2]) + ',' + n2(pk.L[3]) + '" stroke="' + C.rec + '" stroke-width="0.8" stroke-dasharray="2 2"/>');
      o.push(T(pk.x, pk.y, r.text, { size: 16, w: 500, fill: C.rec, anchor: pk.a }) + G1);
    });
    // the reader's dates
    marks.forEach(function (mk, k) {
      o.push(G0('mark:' + k));
      if (mk.y0 < PB) o.push(line(mk.x, mk.y0, mk.x, PB, C.ink, 0.75));
      o.push('<circle cx="' + n2(mk.x) + '" cy="' + n2(mk.y) + '" r="4.6" fill="' + C.ink + '" stroke="#FFFFFF" stroke-width="1.4"/>');
      if (mk.tick) o.push(line(mk.x, PB + 8, mk.x, PB + 14, C.ink, 0.75));
      var pd = labelOf[k];
      if (pd && pd.line) {
        if (pd.L) o.push('<path d="M' + n2(pd.L[0]) + ',' + n2(pd.L[1]) + 'L' + n2(pd.L[2]) + ',' + n2(pd.L[3]) + '" stroke="' + C.ink + '" stroke-width="0.9"/>');
        o.push(T(pd.x, pd.y, pd.it.label, Object.assign({}, mst, { anchor: pd.a })));
      } else if (pd) o.push(T(pd.x, pd.y, pd.it.label, Object.assign({ anchor: 'start' }, pd.st)));
      o.push(G1);
    });

    o.push(G0('title') + title.map(function (t) { return T(t[0], t[1], t[2], t[3]); }).join('') + G1);
    if (lg) o.push(logoMark(lg));
    if (small) o.push(small.svg);
    o.push(qrMark(I.qr, 1690, 1100));
    last_skipped = skipped;
    last_logo = lg ? { x: lg.x, y: lg.y, w: lg.w, h: lg.h } : null;
    return close(I, E, o, bandAt(room, [(PTOP + PB) / 2 + 60, PTOP + (PB - PTOP) * 0.78, PTOP + (PB - PTOP) * 0.3], PTOP + 40, PB - 40, X0 - 6, X1 + 6, E.preview && E.n < N ? [xs(E.n) + 12, X1 + 6] : null, 96));
  }

  // ======================================================================= R1 v2 (MOCKUP, fx/rpv2 only)
  /* Staircase "Clean v2" for Sig to look at (2026-10-17): the panel's agreed changes
     plus the typographer's list. I.v2 = {fill, lineEnds: 'words' | 'figures',
     history: true (I.hist: every full year at the station as a running total),
     histNote}. Nothing on the live site reads this. */
  var V2 = { ink: '#1F2328', date: '#8A8F98', fact: '#5B616B', grid: '#EEF0F2', mon: '#8A8F98', usualM: '#A3A8B0', red: '#B23A2E', thread: '#DDD8D0' };
  function tv(x, y, s, o, date, dateO) {
    // words, then an optional date in its own voice on the same baseline
    o = st(o || {});
    var t = T(x, y, s, o);
    if (date) t = t.replace('</text>', '<tspan font-weight="' + (dateO.w || 400) + '" font-size="' + n2(dateO.size || o.size) + '" fill="' + dateO.fill + '"> ' + esc(date) + '</tspan></text>');
    return t;
  }
  function wv(s, o, date, dateO) { return W(s, o) + (date ? W(' ' + date, Object.assign({}, o, dateO)) : 0); }
  function bv(x, y, s, o, date, dateO) {
    var w = wv(s, o, date, dateO), a = o.anchor || 'start', up = 0.77 * o.size, dn = 0.27 * o.size;
    return { x: a === 'start' ? x : a === 'end' ? x - w : x - w / 2, y: y - up, w: w, h: up + dn };
  }
  function r1v2(I) {
    var O = I.v2 || {}, E = model(I), N = E.N, days = E.days;
    var X0 = 196, X1 = 1590, PTOP = 104, PB = 716, w = (X1 - X0) / N;
    var xs = function (i) { return X0 + i * w; };
    var lastCum = function (i) { for (var k = i; k >= 0; k--) if (E.cum[k] !== null) return E.cum[k]; return 0; };
    var recs = recordPoints(E, I.records);
    var hist = O.history && I.hist ? I.hist : [];
    var room = new Room(), o = [open(I, E)];
    var info = { notes: [] };

    // ---- header: two lines, upper left on the one left edge
    var figs = O.lineEnds !== 'figures';
    var hs = { fam: SERIF, w: 600, size: 30, fill: V2.ink };
    var head = E.verdict || (E.T + ' inches of ' + E.liquid);
    var HY = PTOP + 18, KY = HY + 32;
    var yTxt = E.TU + ' this year', uTxt = E.cmp ? rainAmt(E.normalRec, 'tot') + ' a usual year' : '';
    var ks = { size: 15, w: 500, fill: E.full ? C.rain : C.rain }, us = { size: 15, w: 400, fill: C.mute }, sep = { size: 15, fill: C.soft };
    var headW = W(head, hs), keyW = figs ? 34 + W(yTxt, ks) + 36 + 34 + W(uTxt, us) : 0;
    var HB = (figs ? KY + 6 : HY + 8) + (O.histNote ? 22 : 0);   // the header's lowest ink
    room.add({ b: { x: X0 - 4, y: HY - 26, w: Math.max(headW, keyW) + 12, h: HB - HY + 30 }, own: 'head', k: 'mark' });

    // ---- scale: steps of 5 (10 over 60 in), every labelled line clear of the header, no line without a number
    var top = Math.max(E.total, E.cmp ? E.normalRec : 0, 1);
    hist.forEach(function (h) { top = Math.max(top, h.cum[Math.min(h.cum.length, N) - 1] || 0); });
    var step = top > 60 ? 10 : top > 12 ? 5 : 2;
    var dom = Math.ceil(top / step - 1e-6) * step;
    var y = function (v) { return PB - v * (PB - PTOP) / dom; };
    var ticks = [];
    for (var v = 0; v <= dom + 1e-9; v += step) if (v === 0 || y(v) > HB + 18) ticks.push(v);
    var topTick = ticks[ticks.length - 1];
    ticks.forEach(function (v) { if (v > 0) room.seg(X0, y(v), X1, y(v), 0.7, 'axis', 'soft'); });
    room.seg(X0, PB, X1, PB, 0.9 * PT, 'axis', 'axis');

    // ---- the year as segments (for the room) and as a path
    var d1 = '', prev = 0, pen = false;
    days.forEach(function (x, i) {
      if (E.P[i] === null) { pen = false; return; }
      var c = E.cum[i];
      if (!pen) { d1 += 'M' + n2(xs(i)) + ',' + n2(y(prev)); pen = true; }
      if (c !== prev || !pen) room.seg(xs(i), y(prev), xs(i), y(c), 4, 'data', 'data');
      room.seg(xs(i), y(c), xs(i + 1), y(c), 4, 'data', 'data');
      d1 += 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(i + 1)) + ',' + n2(y(c));
      prev = c;
    });
    var np = '';
    if (E.cmp) {
      var px = X0, py = PB; np = 'M' + X0 + ',' + PB;
      days.forEach(function (x, i) { var qx = xs(i + 1), qy = y(E.ncum[i]); room.seg(px, py, qx, qy, 1.5, 'data', 'usual'); np += 'L' + n2(qx) + ',' + n2(qy); px = qx; py = qy; });
    }
    var inPlot = function (b) { return b.x > X0 + 4 && b.x + b.w < X1 - 2 && b.y + b.h < PB - 6 && b.y > HB + 4; };

    // ---- marked days: the only dark labels, above the line
    var mO = { size: 15, w: 500, fill: V2.ink }, mD = { size: 15, w: 400, fill: V2.date };
    var marks = E.markers.map(function (mk, k) { return { k: k, i: mk.i, x: xs(mk.i + 0.5), y: y(lastCum(mk.i)), words: mk.words, date: mk.date }; });
    marks.forEach(function (mk) {
      room.add({ b: { x: mk.x - 5, y: mk.y - 5, w: 10, h: 10 }, own: 'mark:' + mk.k, k: 'mark' });
      room.seg(mk.x, mk.y + 5, mk.x, PB, 0.75, 'mark:' + mk.k, 'lead');
    });
    // the biggest rain's riser
    var wx = -1, wc0 = 0, wc1 = 0;
    if (E.wi >= 0) { wx = xs(E.wi); wc1 = E.cum[E.wi]; wc0 = wc1 - E.wet.p; room.seg(wx, y(wc0), wx, y(wc1), 4, 'wet', 'data'); }
    // record rings
    var rings = recs.pts.map(function (r, k) { var rg = { x: xs(r.i + 0.5), y: y(lastCum(r.i)) }; room.add({ b: { x: rg.x - 5, y: rg.y - 5, w: 10, h: 10 }, own: 'rec:' + k, k: 'mark' }); return rg; });

    function placeNear(ax, ay, words, o1, date, dO, own, cands, maxLead) {
      return choose(cands.map(function (c) { return { x: ax + c[0], y: ay + c[1], a: c[2] }; }).concat(spots(ax, ay, [], [12, 30, 60, 100]).filter(function (c) { return c.y < ay + (maxLead.below ? 400 : 0); })), function (c) {
        var b = bv(c.x, c.y, words, Object.assign({}, o1, { anchor: c.a }), date, dO);
        if (!inPlot(b)) return 0;
        if (maxLead.above && b.y + b.h > ay - 2 && Math.abs(c.x - ax) < 12) return 0;
        if (maxLead.rg && b.y < ay + 6) return 0;
        var L = [ax, ay, c.x + (c.a === 'start' ? -3 : 3), b.y + b.h / 2];
        if (Math.hypot(L[2] - L[0], L[3] - L[1]) > maxLead.d) return 0;
        if (!room.clear(L, own, 7)) return 0;
        if (!room.free(b, own, false)) return 0;
        c.b = b; c.L = L;
        return room.free(b, own, true) ? 2 : 1;
      });
    }
    var placed = [];
    // biggest rain first (it sits close to its riser), red, the same voice as a marked day
    var wetAt = null, wO = { size: 15, w: 500, fill: V2.red };
    if (wx >= 0) {
      var wmy = (y(wc0) + y(wc1)) / 2;
      wetAt = placeNear(wx, wmy, colon(E.wetLabel) + rainAmt(E.wet.p, 'day'), wO, fmtDate(E.wet.date), mD, 'wet',
        [[-12, -22, 'end'], [-12, -46, 'end'], [-14, 0, 'end'], [-14, -70, 'end'], [12, 40, 'start']], { d: 140 });
      if (wetAt) { room.text(wetAt.b, 'wet'); room.seg(wetAt.L[0], wetAt.L[1], wetAt.L[2], wetAt.L[3], 0.8, 'wet', 'lead'); }
      else info.notes.push('biggest rain not placed');
    }
    marks.forEach(function (mk) {
      var own = 'mark:' + mk.k;
      var pick = placeNear(mk.x, mk.y, mk.words, mO, mk.date, mD, own,
        [[-12, -16, 'end'], [12, -16, 'start'], [-14, -40, 'end'], [14, -40, 'start'], [-14, -64, 'end'], [14, -64, 'start'], [-16, -90, 'end'], [16, -90, 'start']], { d: 120, above: true });
      if (pick) { room.text(pick.b, own); if (Math.hypot(pick.L[2] - pick.L[0], pick.L[3] - pick.L[1]) > 16) room.seg(pick.L[0], pick.L[1], pick.L[2], pick.L[3], 0.8, own, 'lead'); else pick.L = null; }
      else info.notes.push('mark not placed: ' + mk.words);
      mk.at = pick;
    });
    // station facts: 12 u gray footnotes, below the line
    var fO = { size: 12, w: 400, fill: V2.fact }, fD = { size: 12, w: 400, fill: V2.date };
    var footFacts = [];
    var recAt = recs.pts.map(function (r, k) {
      var two = splitDate(r.text), words = two ? two[0] : plain(r.text), date = two ? two[1] : '';
      var rg = rings[k], own = 'rec:' + k;
      var pick = placeNear(rg.x, rg.y, words, fO, date, fD, own,
        [[10, 24, 'start'], [-10, 24, 'end'], [12, 44, 'start'], [-12, 44, 'end'], [14, 66, 'start'], [-14, 66, 'end'], [16, 90, 'start'], [-16, 90, 'end'], [40, 30, 'start'], [-40, 30, 'end'], [60, 56, 'start'], [-60, 56, 'end']], { d: 170, below: true, rg: rg });
      if (pick) { room.text(pick.b, own); room.seg(pick.L[0], pick.L[1], pick.L[2], pick.L[3], 0.7, own, 'lead'); }
      else { info.notes.push('fact to the foot line: ' + words); footFacts.push(plain(r.text).replace(/ (\w{3} \d+)/, ', $1')); }
      return pick ? { p: pick, words: words, date: date } : null;
    });

    // ---- line ends, and the gap at Dec 31
    var endY = y(E.total), endN = E.cmp ? y(E.normalRec) : null, EX = X1 + 12;
    var ends = [];
    if (figs) {
      ends.push(T(EX, endY + 5, 'your year', { size: 15, w: 500, fill: C.rain }));
      if (E.cmp) ends.push(T(EX, endN + 5, 'usual', { size: 15, fill: C.mute }));
    } else {
      ends.push(T(EX, endY + 7, E.TU, { size: 22, w: 600, fill: C.rain }));
      if (E.cmp) ends.push(T(EX, endN + 6, rainAmt(E.normalRec, 'tot') + ' usual', { size: 16, fill: C.mute }));
    }
    var gap = E.cmp ? E.normalRec - E.total : 0, br = '';
    if (E.cmp && Math.abs(gap) >= 0.5 && Math.abs(endY - endN) > 60) {
      var bx = X1 + 6, ya = Math.min(endY, endN) + 16, yb = Math.max(endY, endN) - 16, mid = (ya + yb) / 2;
      br = '<path d="M' + n2(bx + 5) + ',' + n2(ya) + 'H' + n2(bx) + 'V' + n2(yb) + 'H' + n2(bx + 5) + '" fill="none" stroke="' + V2.date + '" stroke-width="0.8"/>' +
        T(bx + 12, mid + 5, rainAmt(Math.abs(gap), 'tot') + (gap > 0 ? ' short' : ' ahead'), { size: 15, w: 500, fill: V2.ink });
    }

    // ---- month row: labels 11 u tracked, totals 14 u tabular ink, usual 11 u light
    var months = [], tab = 'font-variant-numeric:tabular-nums lining-nums';
    E.starts.forEach(function (b, m) {
      var cx = (xs(b) + xs(E.ends[m])) / 2;
      months.push(T(cx, PB + 26, monCap(m), { w: 500, size: 11, ls: 0.08, fill: V2.mon, anchor: 'middle' }));
      if (E.monthHas[m]) months.push(T(cx, PB + 46, rainNum(E.month[m], 'tot'), { size: 14, fill: V2.ink, anchor: 'middle' }).replace('lining-nums', 'tabular-nums lining-nums'));
      if (E.showN) months.push(T(cx, PB + 63, rainNum(E.mN[m], 'tot'), { size: 11, fill: V2.usualM, anchor: 'middle' }).replace('lining-nums', 'tabular-nums lining-nums'));
    });
    // the dry stretch, a footnote under the months
    var dryS = '';
    if (E.dry && E.dry.len >= printDryMin(I)) {
      var da = xs(E.dry.s), db = xs(E.dry.e + 1), ry = PB + 78;
      dryS = '<path d="M' + n2(da) + ',' + ry + 'v5H' + n2(db) + 'v-5" fill="none" stroke="' + V2.date + '" stroke-width="0.7"/>' +
        T((da + db) / 2, ry + 20, E.dry.len + ' dry days', { size: 12, fill: V2.fact, anchor: 'middle' });
    }

    // ---- the name block, the year as big as the name, one left edge
    var NB = 905, title = [];
    if (E.name) {
      var nmS = { fam: SERIF, w: 500, size: 64, fill: V2.ink }, yrS = { fam: SERIF, w: 400, size: 64, fill: V2.ink };
      var gapX = 26;
      while (nmS.size > 40 && W(E.name, nmS) + gapX + W(String(E.year), nmS) > 1300) { nmS.size--; yrS.size = nmS.size; }
      title.push(T(X0 - 2, NB, E.name, nmS));
      title.push(T(X0 - 2 + W(E.name, nmS) + gapX, NB, String(E.year), yrS));
      title.push(T(X0, NB + 40, E.place, { fam: SERIF, w: 400, size: 22, fill: V2.ink }));
    } else {
      title.push(T(X0 - 2, NB, String(E.year), { fam: SERIF, w: 400, size: 64, fill: V2.ink }));
      title.push(T(X0, NB + 40, E.place, { fam: SERIF, w: 400, size: 22, fill: V2.ink }));
    }
    if (E.dedication) title.push('<text x="' + X0 + '" y="' + (NB + 70) + '" font-family="' + esc(SERIF) + '" font-style="italic" font-weight="400" font-size="17" fill="' + V2.fact +
      '" style="font-variation-settings:\'opsz\' 12;font-variant-ligatures:no-discretionary-ligatures;font-feature-settings:\'swsh\' 0,\'dlig\' 0">' + esc(E.dedication) + '</text>');

    // ---- the foot: 12 u, two lines, "usual" said once
    var foot1 = [E.gauge, 'Inches of ' + E.liquid + ', Jan 1 to Dec 31, ' + E.year];
    if (E.snowText) foot1.push('Snow ' + E.snowTot.toFixed(1) + ' in, the light blue steps');
    foot1.push(E.daysText);
    footFacts.forEach(function (t) { foot1.push(t); });
    var foot2 = [];
    if (E.cmp) foot2.push('A usual year: NOAA’s 30-year normal (1991 to 2020); the usual month total is the gray number under each month');
    if (E.snowNote) foot2.push(E.snowNote);
    if (hist.length) foot2.push('Gray lines: every full year this station kept, ' + O.histSpan);
    if (E.missing > GAP_QUIET) foot2.push('Gaps: ' + E.missing + ' days with no report');
    var fS = { size: 12, fill: V2.fact };
    var SEPF = '  \u00b7  ', FW = 1380, lines = [[]], dropped = [];
    var core = foot1.filter(function (t) { return footFacts.indexOf(t) < 0; });
    function addPart(t) {
      var cur = lines[lines.length - 1];
      if (!cur.length || W(cur.concat([t]).join(SEPF), fS) <= FW) { cur.push(t); return; }
      lines.push([t]);
    }
    core.forEach(addPart);
    lines.push([]); foot2.forEach(addPart);
    footFacts.forEach(function (t) {
      for (var li = 0; li < lines.length; li++) if (W(lines[li].concat([t]).join(SEPF), fS) <= FW) { lines[li].push(t); return; }
      if (lines.length < 3) { lines.push([t]); return; }
      dropped.push(t);
    });
    lines = lines.filter(function (l) { return l.length; });
    info.footDropped = dropped;
    var foot = lines.map(function (l, k) { return T(X0, 1081 - (lines.length - 1 - k) * 19, l.join(SEPF), fS); }).join('');
    info.footW = Math.max.apply(null, lines.map(function (l) { return W(l.join(SEPF), fS); }));

    // ================= draw, back to front
    o.push(G0('axis'));
    ticks.forEach(function (v) { if (v > 0) o.push(line(X0, y(v), X1, y(v), V2.grid, 0.7)); });
    ticks.forEach(function (v) { o.push(T(X0 - 12, y(v) + 4.5, String(v), { size: 13, fill: V2.date, anchor: 'end' })); });
    o.push(G1);
    // header
    var hx = X0, hp = [T(hx, HY, head, hs)];
    if (figs) {
      hp.push(line(hx, KY - 5, hx + 24, KY - 5, C.rain, 4)); hx += 34;
      hp.push(T(hx, KY, yTxt, ks)); hx += W(yTxt, ks);
      hp.push(T(hx + 18, KY, '·', Object.assign({}, sep, { anchor: 'middle' }))); hx += 36;
      if (E.cmp) { hp.push('<path d="M' + n2(hx) + ',' + (KY - 5) + 'h24" stroke="' + C.mute + '" stroke-width="1.5" stroke-dasharray="6 5"/>'); hx += 34; hp.push(T(hx, KY, uTxt, us)); }
    }
    if (O.histNote) hp.push(T(X0, (figs ? KY : HY) + 22, O.histNote, { size: 12, fill: V2.fact }));
    o.push(G0('head') + hp.join('') + G1);
    // every year behind this one
    if (hist.length) {
      var hpath = '';
      hist.forEach(function (h) {
        var s = 'M' + X0 + ',' + PB;
        for (var i = 0; i < Math.min(h.cum.length, N); i += 1) s += 'L' + n2(xs(i + 1)) + ',' + n2(y(h.cum[i]));
        hpath += '<path d="' + s + '"/>';
      });
      o.push(G0('hist') + '<g fill="none" stroke="' + (O.threadInk || V2.thread) + '" stroke-opacity="' + (O.threadOpacity || 0.4) + '" stroke-width="0.7" stroke-linejoin="round">' + hpath + '</g>' + G1);
    }
    // the band between the year and a usual year (none when the history replaces it)
    if (E.cmp && !hist.length && O.fill) {
      var band = '', last = 0;
      days.forEach(function (x, i) {
        if (E.cum[i] !== null) last = E.cum[i];
        var a = y(last), b = y(E.ncum[i]);
        if (Math.abs(a - b) < 0.3) return;
        band += '<rect x="' + n2(xs(i)) + '" y="' + n2(Math.min(a, b)) + '" width="' + n2(w + 0.25) + '" height="' + n2(Math.abs(a - b)) + '" fill="' + (a > b ? O.fill : (O.wetFill || '#EAEFF4')) + '"/>';
      });
      o.push(G0('band') + '<g shape-rendering="crispEdges">' + band + '</g>' + G1);
    }
    if (E.cmp) o.push(G0('usual') + '<path d="' + np + '" fill="none" stroke="' + C.mute + '" stroke-width="1.5" stroke-dasharray="6 5"/>' + G1);
    o.push(G0('axis') + line(X0, PB, X1, PB, V2.ink, 0.9 * PT));
    E.starts.concat([isLeap(E.year) ? 366 : 365]).forEach(function (b) { if (b <= N) o.push(line(xs(b), PB, xs(b), PB + 7, V2.ink, 0.75 * PT)); });
    o.push(G1);
    // the year: 4 u, snow steps in ice blue on the line (above the line only)
    o.push(G0('data') + '<path d="' + d1 + '" fill="none" stroke="' + C.rain + '" stroke-width="4" stroke-linejoin="round" stroke-linecap="butt"/>');
    if (E.full) {
      var sp = '';
      days.forEach(function (x, i) {
        if (E.P[i] === null || !(x.s > 0) || !(E.P[i] > 0)) return;
        var c = E.cum[i], c0 = c - E.P[i];
        var j = i + 1; while (j < E.n && E.P[j] === 0 && !(days[j].s > 0)) j++;
        sp += 'M' + n2(xs(i)) + ',' + n2(y(c0)) + 'L' + n2(xs(i)) + ',' + n2(y(c)) + 'L' + n2(xs(Math.min(j, E.n))) + ',' + n2(y(c));
      });
      if (sp) o.push('<path d="' + sp + '" fill="none" stroke="' + C.snowLine + '" stroke-width="4" stroke-linejoin="round"/>');
    }
    o.push(G1);
    if (wx >= 0) o.push(G0('wet') + line(wx, y(wc0) + 1.5, wx, y(wc1) - 1.5, V2.red, 4) + G1);
    o.push(G0('months') + months.join('') + dryS + G1);
    // facts
    recs.pts.forEach(function (r, k) {
      var a = recAt[k], rg = rings[k]; if (!a) return;
      o.push(G0('rec:' + k) + '<circle cx="' + n2(rg.x) + '" cy="' + n2(rg.y) + '" r="4" fill="#FFFFFF" stroke="' + V2.fact + '" stroke-width="1.2"/>' +
        '<path d="M' + n2(a.p.L[0]) + ',' + n2(a.p.L[1]) + 'L' + n2(a.p.L[2]) + ',' + n2(a.p.L[3]) + '" stroke="' + V2.fact + '" stroke-width="0.7"/>' +
        tv(a.p.x, a.p.y, a.words, Object.assign({}, fO, { anchor: a.p.a }), a.date, fD) + G1);
    });
    if (wetAt) o.push(G0('wet') + '<path d="M' + n2(wetAt.L[0]) + ',' + n2(wetAt.L[1]) + 'L' + n2(wetAt.L[2]) + ',' + n2(wetAt.L[3]) + '" stroke="' + V2.red + '" stroke-width="0.8"/>' +
      tv(wetAt.x, wetAt.y, colon(E.wetLabel) + rainAmt(E.wet.p, 'day'), Object.assign({}, wO, { anchor: wetAt.a }), fmtDate(E.wet.date), mD) + G1);
    marks.forEach(function (mk) {
      o.push(G0('mark:' + mk.k) + line(mk.x, mk.y + 5, mk.x, PB, V2.ink, 0.75) + '<circle cx="' + n2(mk.x) + '" cy="' + n2(mk.y) + '" r="4.6" fill="' + V2.ink + '" stroke="#FFFFFF" stroke-width="1.4"/>');
      if (mk.at) {
        if (mk.at.L) o.push('<path d="M' + n2(mk.at.L[0]) + ',' + n2(mk.at.L[1]) + 'L' + n2(mk.at.L[2]) + ',' + n2(mk.at.L[3]) + '" stroke="' + V2.ink + '" stroke-width="0.8"/>');
        o.push(tv(mk.at.x, mk.at.y, mk.words, Object.assign({}, mO, { anchor: mk.at.a }), mk.date, mD));
      }
      o.push(G1);
    });
    o.push(G0('ends') + ends.join('') + br + G1);
    o.push(G0('title') + title.join('') + G1);
    o.push(G0('foot') + foot + G1);
    o.push(qrMark(I.qr, 1690, 1081));
    if (I.crop) o.push(cropStrip(I, E, { xs: function (i) { return xs(i + 0.5); }, y: PB + 96, X0: X0, X1: X1 }));
    root.__rpv2info = info;
    o.push('</svg>');
    return o.join('');
  }

  // ======================================================================= crop growth strip (MOCKUP, fx/rpv2 only)
  /* E (Sig's idea, 2026-10-17): between the buyer's plant and harvest days, a quiet
     row of line-art plants, each on the day the station's own growing degree days
     reached that stage. I.crop = {kind: 'corn' | 'bean', plant: doy, harvest: doy,
     stages: [{key, label, doy, date}], ghost: [{key, doy}] or null, keyNote}.
     The stage dates are worked out before render (scratch harness) from NOAA
     daily temps with the GDU calculator's 86/50 math and components/gdu-stages.js. */
  var CROP_INK = '#5B616B', GHOST_INK = '#CFCBC4';
  // one plant, base at (x, b), in ink; h is the full height of a grown plant
  function plantArt(kind, key, x, b, ink, h) {
    var p = [], sw = 0.9;
    var L = function (d) { p.push('<path d="' + d + '"/>'); };
    var leaf = function (y, side, len, droop) {   // a leaf from the stalk at height y
      var s = side, ex = x + s * len, ey = b - y + (droop || -len * 0.35);
      L('M' + n2(x) + ',' + n2(b - y) + 'Q' + n2(x + s * len * 0.55) + ',' + n2(b - y - len * 0.45) + ' ' + n2(ex) + ',' + n2(ey));
    };
    if (key === 'seed') {
      p.push('<ellipse cx="' + n2(x) + '" cy="' + n2(b - 2.6) + '" rx="2.2" ry="3" />');
    } else if (kind === 'corn') {
      if (key === 'VE') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - 7)); leaf(6, 1, 5); leaf(5, -1, 4); }
      else if (key === 'V6') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - h * 0.45)); leaf(h * 0.12, -1, 9); leaf(h * 0.2, 1, 10); leaf(h * 0.3, -1, 10); leaf(h * 0.4, 1, 9); }
      else {
        var dry = key === 'R6', droop = key === 'R5' || dry;
        L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - h));
        // leaves, drooping as the plant dries down
        [0.18, 0.32, 0.46, 0.6, 0.74].forEach(function (f, k) { var s = k % 2 ? 1 : -1; leaf(h * f, s, dry ? 9 : 12, droop ? (dry ? 9 : 3) : null); });
        // tassel
        L('M' + n2(x) + ',' + n2(b - h) + 'l-4,-6M' + n2(x) + ',' + n2(b - h) + 'l4,-6M' + n2(x) + ',' + n2(b - h) + 'v-8');
        // the ear at about half height: silk hairs at R1, angled down at maturity
        var ey = b - h * 0.5;
        if (key === 'R1' || key === 'VT') p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q4,-2 4,-9q0,-4 -3,-4" /><path d="M' + n2(x + 4) + ',' + n2(ey - 13) + 'q3,-4 6,-3M' + n2(x + 4) + ',' + n2(ey - 13) + 'q4,-1 7,2" />');
        else if (key === 'R5') p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q6,-2 6,-11q0,-4 -4,-4z" />');
        else if (dry) p.push('<path d="M' + n2(x + 1) + ',' + n2(ey) + 'q8,1 10,8q-6,3 -10,-2z" />');
      }
    } else {
      // soybeans: a low bushy plant; trifoliates, then flowers, pods, and bare stems with pods at maturity
      var tri = function (cx, cy, r) { [-1, 0, 1].forEach(function (k) { var a = -Math.PI / 2 + k * 0.9; p.push('<ellipse cx="' + n2(cx + Math.cos(a) * r) + '" cy="' + n2(cy + Math.sin(a) * r) + '" rx="' + n2(r * 0.55) + '" ry="' + n2(r * 0.9) + '" transform="rotate(' + n2(k * 50) + ' ' + n2(cx + Math.cos(a) * r) + ' ' + n2(cy + Math.sin(a) * r) + ')"/>'); }); };
      var bh = h * 0.6;
      if (key === 'VE') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - 6)); p.push('<ellipse cx="' + n2(x - 3) + '" cy="' + n2(b - 7) + '" rx="3" ry="1.8"/><ellipse cx="' + n2(x + 3) + '" cy="' + n2(b - 7) + '" rx="3" ry="1.8"/>'); }
      else if (key === 'V3') { L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - bh * 0.55)); tri(x, b - bh * 0.55, 3.2); L('M' + n2(x) + ',' + n2(b - bh * 0.3) + 'l-7,-4'); tri(x - 8, b - bh * 0.3 - 5, 2.6); }
      else {
        L('M' + n2(x) + ',' + n2(b) + 'V' + n2(b - bh));
        [[0.3, -1], [0.5, 1], [0.7, -1]].forEach(function (q) { L('M' + n2(x) + ',' + n2(b - bh * q[0]) + 'l' + n2(q[1] * 8) + ',-5'); if (key !== 'R7') tri(x + q[1] * 9, b - bh * q[0] - 7, 2.6); });
        if (key !== 'R7') tri(x, b - bh - 4, 3);
        if (key === 'R1') p.push('<circle cx="' + n2(x + 3) + '" cy="' + n2(b - bh * 0.45) + '" r="1.4"/>');
        if (key === 'R5' || key === 'R7') [0.25, 0.45, 0.65].forEach(function (f) { p.push('<path d="M' + n2(x + 1) + ',' + n2(b - bh * f) + 'q4,1 4,6" />'); });
      }
    }
    return '<g fill="none" stroke="' + ink + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' + p.join('') + '</g>';
  }
  function cropStrip(I, E, g) {
    var c = I.crop, base = g.base, h = 54, o = [], lab = { size: 11.5, fill: CROP_INK, anchor: 'middle' };
    var xa = g.xs(c.plant), xb = g.xs(Math.min(c.harvest, E.n - 1));
    o.push(line(xa, base, xb, base, CROP_INK, 0.8));
    o.push(line(xb, base - 4, xb, base + 4, CROP_INK, 0.8));
    // the usual year, behind
    if (c.ghost) c.ghost.forEach(function (s) { if (s.doy <= c.harvest) o.push(plantArt(c.kind, s.key, g.xs(s.doy), base, GHOST_INK, h)); });
    o.push(plantArt(c.kind, 'seed', xa, base, CROP_INK, h));
    var labs = [];
    c.stages.forEach(function (s) {
      if (s.doy > c.harvest) return;   // harvest came first: draw only what the season reached
      var x = g.xs(s.doy);
      o.push(plantArt(c.kind, s.key, x, base, CROP_INK, h));
      var t = s.label + ' ' + fmtDate(s.date);
      labs.push({ x: x, t: t, note: c.ghost && s.note ? s.note : '' });
    });
    // labels under the row, nudged apart so none touch
    labs.forEach(function (l) { l.w = W(l.t, lab); l.cx = l.x; });
    for (var it = 0; it < 30; it++) for (var k = 1; k < labs.length; k++) {
      var a = labs[k - 1], b2 = labs[k], need = (a.w + b2.w) / 2 + 12 - (b2.cx - a.cx);
      if (need > 0) { a.cx -= need / 2; b2.cx += need / 2; }
    }
    labs.forEach(function (l) {
      o.push(T(l.cx, base + 17, l.t, lab));
      if (l.note) o.push(T(l.cx, base + 31, l.note, { size: 11.5, fill: '#8A8F98', anchor: 'middle' }));
    });
    return G0('crop') + o.join('') + G1;
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
    var G = 478, SH = 92, RB = 1000, RH = RB - G - 6;
    // the rain scale reaches the deepest bar drawn below the ground (a snow day is drawn above it only)
    var maxRain = Math.max.apply(null, [0.01].concat(days.map(function (x, i) { return E.P[i] !== null && !(E.full && x.s > 0) ? E.P[i] : 0; })));
    var R = niceRain(maxRain), S = niceSnow(E.maxSnow);
    var ry = function (p) { return G + p * RH / R.dom; }, sy = function (s) { return G - s * SH / S.dom; };
    var xs = function (i) { return X0 + (i + 0.5) * w; };
    var o = [open(I, E)], room = new Room();
    var recs = recordPoints(E, I.records);
    E.style2 = true;
    var put = function (list, own) { list.forEach(function (t) { room.text(box(t[0], t[1], t[2], t[3]), own); }); };
    var draw = function (list) { return list.map(function (t) { return T(t[0], t[1], t[2], t[3]); }).join(''); };

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
    var bw = 0.85 * w, sw = 0.85 * w, bars = '', snows = '', barBoxes = [];
    days.forEach(function (x, i) {
      var p = E.P[i], cx = xs(i);
      if (p === null) return;
      if (E.full && x.s > 0) {
        var h = Math.max(1.4, G - sy(x.s)), sb = { x: cx - sw / 2 + 0.35, y: G - 2.2 - h + 0.35, w: sw - 0.7, h: h - 0.7 };
        snows += '<rect x="' + n2(sb.x) + '" y="' + n2(sb.y) + '" width="' + n2(sb.w) + '" height="' + n2(sb.h) + '"/>';
        room.add({ b: sb, own: 'data', k: 'mark' });
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

    // the scale's names: rain at the foot of its scale, or under the soil if a bar is in the way
    var rainTitle = (E.full ? tr('rain') : E.liquid) + ', ' + rU(), rtSt = { size: 15, fill: C.mute };
    var rty = [ry(R.ticks[R.ticks.length - 1]) + 36, RB + 24].filter(function (yy) { return room.free(box(ML, yy, rainTitle, rtSt), 'axis', false); })[0] || RB + 24;
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
    room.add({ b: { x: ML, y: FOOT_Y - FOOT_GAP - 0.77 * 15, w: 1440, h: FOOT_GAP + 1.04 * 15 }, own: 'foot', k: 'text' });

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

    // ---- the biggest rain, in red, in words, beside the foot of its bar
    var wetAt = null;
    if (E.wi >= 0) {
      var wst = { w: 500, size: 24, fill: C.accent };
      var wc = [{ x: wcx + 10, y: wy2 + 6, a: 'start', bare: true }, { x: wcx - 10, y: wy2 + 6, a: 'end', bare: true },
        { x: wcx + 10, y: wy2 - 6, a: 'start', bare: true }, { x: wcx - 10, y: wy2 - 6, a: 'end', bare: true }]
        .concat(spots(wcx, wy2 + 6, [], [10, 30, 70, 130]).filter(function (c) { return c.y > wy2 - 30; }));
      wetAt = choose(wc, function (c) {
        var b = box(c.x, c.y, E.wetText, Object.assign({}, wst, { anchor: c.a }));
        if (b.x < X0 || b.x + b.w > X1 || b.y < G + 8 || b.y + b.h > 1060) return 0;
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
      for (var yy = G + 70; yy <= RB + 50; yy += 15) cands.push({ x: x + 8, y: yy, a: 'start' }, { x: x - 8, y: yy, a: 'end' }, { x: x, y: yy, a: 'middle' });
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
    if (I.crop && I.crop.foot) I.crop.foot.forEach(function (t) { foot.push(t); });
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
    if (I.crop) {
      var cxa = xs(I.crop.plant) - 12, cxb = xs(I.crop.harvest) + 12, low = RB - 120;
      barBoxes.forEach(function (bb) { if (bb.x + bb.w > cxa && bb.x < cxb) low = Math.max(low, bb.y + bb.h); });
      if (wetAt && wetAt.b && wetAt.b.x + wetAt.b.w > cxa && wetAt.b.x < cxb) low = Math.max(low, wetAt.b.y + wetAt.b.h);
      o.push(cropStrip(I, E, { xs: xs, base: Math.max(1046, Math.min(1056, low + 30)) }));
    }
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
      svg = J.style === 'r2' ? r2(J) : (J.v2 ? r1v2(J) : r1(J));
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
