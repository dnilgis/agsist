/* components/rain-print.js: Rain Print by AGSIST (/rain-print), 2026-10-11.
 *
 * A place and a finished year become a print: every day's precipitation at
 * the nearest NOAA weather station with a usable record, drawn in one of the
 * two styles Sig picked (2026-10-13): R1 Staircase (the running total, the
 * default) or R2 Roots (snow piled above the ground line, rain soaking down
 * below it). components/rain-print-art.js draws both; this file feeds it.
 * Optional: a dedication line, NOAA's 30-year normal under each month's total,
 * and remarkable days (components/rain-print-records.js, loaded on first use).
 * The QR on every preview is the standard code to the Rain Print page; only
 * the files Sig makes after payment carry the print's own short link
 * (components/rp-short.js), made at the moment of export (2026-10-14).
 * The serial "No. 0001" goes under it on Sig's print files only; Sig initials each
 * physical print by hand in pencil beside it (Oct 15), so no printed initials
 * (?maker=1&serial=1), never on the digital file or the public page.
 * Ported from Sig's standalone Rain Print Studio (the October last-pass
 * version, with its QR, marker, callout and dry-spell fixes); the art is his design.
 *
 * WHERE THE NUMBERS COME FROM (nothing here is invented or filled in)
 *   place     Open-Meteo geocoding (geocoding-api.open-meteo.com)
 *   stations  RCC-ACIS StnMeta, stations within about 0.6 degrees whose
 *             precipitation record spans the whole year, each marked for
 *             whether its snowfall record does too (pickStation prefers one
 *             that does, a few miles farther, where snow is normal)
 *   days      RCC-ACIS StnData pcpn + avgt for that station and year
 *   scale     the station's full period of record (same scale every year)
 *   compare   ACIS's own NOAA 30-year normal (normal:1; which 30 years ACIS
 *             serves was not verified with a live request, so no label names
 *             the period), or the station's own full-record daily average,
 *             labeled with its years
 *   A station with more than MISS_BLOCK unrecorded days in the year gets no
 *   print: the page says so and offers the other stations. Fewer missing days
 *   are left as gaps in the line (never drawn as dry, never added to either
 *   total), and no count of them is printed on the art (Sig); the line under
 *   the print on the page states how many there were.
 *
 * THE DESIGN IS THE URL. Every choice (place, station, year, layout, palette,
 * size, comparison, name, up to five dates) round-trips through the query
 * string, and through a short design code (?d=...) that the QR maker's mark,
 * Stripe's client_reference_id and the order form all carry. Open
 * /rain-print?d=<code> and the same print draws again.
 *
 * DOWNLOADS. The public button gives a watermarked preview PNG. /rain-print?maker=1
 * shows Sig's clean 300 dpi print files (the 13 x 19 in sheet, untrimmed, the art
 * 16.5 x 11 in in the middle: SHEET, 2026-10-17),
 * a PDF of the same and the SVG. That switch is a convenience, not security:
 * the art is drawn in the reader's browser and anyone can save it.
 *
 * THIS YEAR, AS A GIFT (2026-10-11). The year list starts with the current
 * year (America/Chicago), offered as a gift delivered in January. It draws a
 * PREVIEW from Jan 1 through the station's last recorded day, laid out on the
 * whole calendar, with a band across the art and a line on the page saying so;
 * a comparison covers the same days. Under GIFT_MIN_DAYS recorded days there
 * is no art, only a plain message, and ordering stays open. A gift order's
 * code is GIFT- plus the design code (Stripe's client_reference_id and the
 * order form carry it); the QR and shared links carry the plain code. A
 * gift card is issued by Sig after payment (components/rp-gift.js, worker v5.16);
 * a ?gift=CODE link redeems one here (see THE GIFT CARD below).
 *
 * PRODUCTS (2026-10-11; paper 13 x 19 from 2026-10-17, SHEET): digital file (the art, 18 x 12 in), print, framed; Sig
 * prints, frames and ships them. 18 x 24 is gone; an old code with its size
 * letter still opens as 12 x 18. The maker's seal is square to the page.
 *
 * THE PAGE AROUND IT (2026-10-12). The art sits in a CSS frame on a wall tone
 * at the top of the page (#rp-wall; "Print only" takes the frame off). With no
 * design in the URL it shows the Chetek sample, labeled as one. The order
 * buttons stay live while the sample shows: they send the reader up to the
 * town box, since an order carries the reader's own design.
 *
 * FOR BUSINESSES (2026-10-12). A quote request for a set of prints (#rb-form,
 * kind rain-print-business, subs worker v5.12): business, contact, how many,
 * product, towns and years, ship to one address or each customer. It needs no
 * drawn design. The cutoff line, the price table and the per-print readout
 * come from business_cutoff, business_note, business_tiers,
 * business_one_address_off and business_quote_max in data/rain-print.json.
 * Since 2026-10-13 (Sig): 5 prints up, one delivered price per print like
 * the cards, $ off each print shipped all to one address; over the quote max
 * Sig quotes it. Consumer orders above it never use them.
 *
 * A LOGO (2026-10-14, Sig: "a real upload button"). Under the name and the
 * line, a buyer can add a farm or business logo (components/rp-logo.js reads
 * and trims it in the browser; the subs worker v5.23 keeps the PNG). It prints
 * small beside the name block, in the print's ink or in its own colors. The
 * design carries its id and that switch (logo=, logoInk=, and the code's key
 * field), so the short link, the QR, the checkout reference, the order and the
 * gift card all draw the same logo.
 *
 * The pure parts (design code, query string, business tiers) run without a document, for
 * test/rain-print.test.mjs.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- pure parts
  var LAYOUT = { staircase: 's', waveform: 'w' };
  var PALETTE = { paper: 'p', night: 'n', blueprint: 'b' };
  var CMP = { none: '0', normal: 'n', station: 's' };
  var SIZE = { '12x18': 'a' };   // one print size since 2026-10-11 (18 x 24 was dropped)
  /* The art (2026-10-13): R1 Staircase (default) or R2 Roots, drawn by
     components/rain-print-art.js. Layout and palette still round-trip so an old
     link opens; they no longer change the art (an old Waveform link opens as R2). */
  var STYLE = { r1: 1, r2: 2 };
  /* markers: up to five marked days (Sig, 2026-10-15: "I don't want 100 dates, but if someone had 4 or 5 why not");
     the art leaves off a day it can't place cleanly and says which (AgRainArt.lastUnplaced) */
  var LIMITS = { place: 32, name: 24, label: 13, markers: 5, dedication: 70 };
  /* The order files' QR carries the short link (rp-short.js), which fits at
     any length; previews carry the standard code below. The dedication went
     from 40 to 70 (2026-10-13) after the longest line was drawn at both styles.
     A code over Stripe's 200 characters goes to checkout as its short-link id
     (checkoutRef below). */
  var SITE = 'https://agsist.com/rain-print';
  /* The standard code (2026-10-14, Sig: no working QR for a design until
     someone pays). Every preview, test print and mockup carries this one fixed
     QR to the Rain Print page; only the files Sig makes after payment carry the
     print's own short link. Uppercase keeps it in QR alphanumeric mode: version
     2 at level M, 25 x 25 modules, the same printed size as the short link. */
  var STANDARD_LINK = 'HTTPS://AGSIST.COM/RAIN-PRINT', STD_M = null;
  /* THE SHEET (2026-10-17, Sig): prints and framed prints are printed on 13 x 19 in
     paper and ship untrimmed. The 3:2 art (1800 x 1200 units) is scaled to 16.5 x
     11 in and centred on the sheet; the margin is the print's own white. The
     framed print sits in a 13 x 19 black frame with a white mat (the stock
     "matted to 11 x 17" kind, window about 16.5 x 10.5 in), so everything the
     art draws stays inside the centred safe window, which
     test/rain-print-sheet.test.mjs measures on the drawn sheet. When Sig
     measures the real mat, change mat and safe here (inches, landscape). The
     digital file is the art alone, 18 x 12 in at 300 dpi, as before. */
  var SHEET = { w: 19, h: 13, art: { w: 16.5, h: 11 }, mat: { w: 16.5, h: 10.5 }, safe: { w: 16.25, h: 10.25 } };
  // where the art and the windows sit on the sheet, in inches from the sheet's top left
  function sheetBoxes(S) {
    S = S || SHEET;
    var at = function (b) { return { x: (S.w - b.w) / 2, y: (S.h - b.h) / 2, w: b.w, h: b.h }; };
    return { sheet: { x: 0, y: 0, w: S.w, h: S.h }, art: at(S.art), mat: at(S.mat), safe: at(S.safe) };
  }
  // the safe window in the art's own units (1800 x 1200 across the art): what the art must keep its ink inside
  function safeInArt(S) {
    S = S || SHEET;
    var B = sheetBoxes(S), k = 1800 / S.art.w;
    return { x0: (B.safe.x - B.art.x) * k, y0: (B.safe.y - B.art.y) * k, x1: (B.safe.x - B.art.x + B.safe.w) * k, y1: (B.safe.y - B.art.y + B.safe.h) * k };
  }
  function standardMatrix() {
    if (!STD_M && root.AgQR) STD_M = root.AgQR.matrix(STANDARD_LINK, null, 'alnum');
    return STD_M ? STD_M.map(function (r) { return r.slice(); }) : null;
  }

  function inv(o) { var r = {}; Object.keys(o).forEach(function (k) { r[o[k]] = k; }); return r; }
  var LAYOUT_R = inv(LAYOUT), PALETTE_R = inv(PALETTE), CMP_R = inv(CMP), SIZE_R = inv(SIZE);
  SIZE_R.b = '12x18';  // a code made while 18 x 24 was offered still opens, as the 12 x 18 shape (same art)

  function cleanText(s, n) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n).trim();
  }
  /* Only characters the print's fonts have (Fraunces and IBM Plex Sans, both
     Latin: ASCII, Latin-1, curly quotes, dashes, the ellipsis, the bullet).
     Emoji and other symbols would print in a fallback font that differs by
     machine, so they are left out and the page says so. */
  var PRINTABLE = /[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u0152\u0153]/g;
  function printable(s) { return String(s == null ? '' : s).replace(/\uFE0F|\u200D/g, '').replace(PRINTABLE, ''); }
  function hasUnprintable(s) { PRINTABLE.lastIndex = 0; var r = PRINTABLE.test(String(s || '')); PRINTABLE.lastIndex = 0; return r; }
  function cleanSid(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 16); }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function dayIndex(year, iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m || +m[1] !== year) return -1;
    var t = Date.UTC(year, +m[2] - 1, +m[3]);
    var d = new Date(t);
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return -1;
    return Math.round((t - Date.UTC(year, 0, 1)) / 86400000);
  }
  function isoFromDay(year, doy) {
    if (!(doy >= 0) || doy >= (isLeap(year) ? 366 : 365)) return '';
    return new Date(Date.UTC(year, 0, 1) + doy * 86400000).toISOString().slice(0, 10);
  }

  function defaults() {
    return { place: '', station: '', year: null, layout: 'staircase', palette: 'paper', size: '12x18', cmp: 'none', name: '', markers: [], gift: false,
      style: 'r1', dedication: '', normals: false, records: false, logo: '', logoInk: true, units: '', lang: '',
      crop: '', cropPlant: '', cropHarvest: '', plants: false, ghost: false, hist: false, frost: false, heat: false, ribbon: false };
  }
  /* The 2026-10-17 options (Sig). crop: '' | 'corn' | 'soy', placed between the planting and harvest days
     (cropPlant, cropHarvest: dates in the year, picked from the marked days); plants: draw the little plants;
     ghost: the same crop on a usual year's temperatures; hist: every full year the station kept, behind the
     year (Staircase); frost: the last and first frost marked on the date line; heat: the hottest and coldest
     day in the foot line; ribbon: each day's high and low in a thin band. A new design starts with frost and
     heat on (the page and a hand-written link); a code or tool link made before them opens as it was made. */
  var CROP_KEYS = { corn: 'c', soy: 's' }, CROP_R = { c: 'corn', s: 'soy' }, OPT_FLAGS = ['plants', 'ghost', 'hist', 'frost', 'heat', 'ribbon'], OPT_LETTER = 'pghftr';
  function flag(v) { return v === true || v === '1' || v === 1; }
  // a stored logo's id (subs worker v5.23): 12 characters of lowercase Crockford base32
  function cleanLogo(v) {
    var id = String(v == null ? '' : v).trim().toLowerCase().replace(/[il]/g, '1').replace(/o/g, '0');
    return /^[0-9a-hjkmnp-tv-z]{12}$/.test(id) ? id : '';
  }
  /* Whatever came in (URL, code, form), out comes a design with only allowed values. */
  function normalize(x) {
    var s = defaults();
    x = x || {};
    s.place = cleanText(x.place, LIMITS.place);
    s.station = cleanSid(x.station);
    var y = parseInt(x.year, 10);
    s.year = y >= 1850 && y <= 2200 ? y : null;
    if (LAYOUT[x.layout]) s.layout = x.layout;
    if (PALETTE[x.palette]) s.palette = x.palette;
    if (CMP[x.cmp]) s.cmp = x.cmp;
    if (SIZE[x.size]) s.size = x.size;
    s.name = cleanText(printable(x.name), LIMITS.name);
    (Array.isArray(x.markers) ? x.markers : []).forEach(function (m) {
      if (s.markers.length >= LIMITS.markers || !m || !s.year) return;
      if (dayIndex(s.year, m.date) < 0) return;
      s.markers.push({ date: m.date, label: cleanText(printable(m.label), LIMITS.label) });
    });
    s.gift = x.gift === true || x.gift === '1' || x.gift === 1;
    s.style = STYLE[x.style] ? x.style : (x.layout === 'waveform' ? 'r2' : 'r1');
    s.dedication = cleanText(printable(x.dedication), LIMITS.dedication);
    s.normals = x.normals === true || x.normals === '1' || x.normals === 1;
    s.records = x.records === true || x.records === '1' || x.records === 1;
    s.logo = cleanLogo(x.logo);
    // ink color unless the design says its own colors
    s.logoInk = !s.logo || !(x.logoInk === false || x.logoInk === '0' || x.logoInk === 0);
    // units and language (2026-10-16, Canada): '' is the place's own default (inches and English in the US; see locOf)
    s.units = x.units === 'mm' || x.units === 'in' ? x.units : '';
    s.lang = x.lang === 'fr' || x.lang === 'en' ? x.lang : '';
    OPT_FLAGS.forEach(function (k) { s[k] = flag(x[k]); });
    var cp = s.year ? dayIndex(s.year, x.cropPlant) : -1, ch = s.year ? dayIndex(s.year, x.cropHarvest) : -1;
    if (CROP_KEYS[x.crop] && cp >= 0 && ch > cp) { s.crop = x.crop; s.cropPlant = x.cropPlant; s.cropHarvest = x.cropHarvest; }
    else s.plants = s.ghost = false;   // the plant switches mean nothing without a crop
    return s;
  }
  // the options in the code's key field: "~" + crop letter and the two days (base 36, two letters each) + one letter per switch on
  function optCode(s) {
    var t = s.crop ? CROP_KEYS[s.crop] + ('0' + dayIndex(s.year, s.cropPlant).toString(36)).slice(-2) + ('0' + dayIndex(s.year, s.cropHarvest).toString(36)).slice(-2) : '';
    OPT_FLAGS.forEach(function (k, i) { if (s[k]) t += OPT_LETTER[i]; });
    return t ? '~' + t : '';
  }
  var OPT_RE = /^(?:([cs])([0-9a-z]{2})([0-9a-z]{2}))?(p?)(g?)(h?)(f?)(t?)(r?)$/;
  function optDecode(t, year) {
    var m = OPT_RE.exec(t), o = {};
    if (!m || !t) return null;
    if (m[1]) { o.crop = CROP_R[m[1]]; o.cropPlant = isoFromDay(year, parseInt(m[2], 36)); o.cropHarvest = isoFromDay(year, parseInt(m[3], 36)); if (!o.cropPlant || !o.cropHarvest) return null; }
    OPT_FLAGS.forEach(function (k, i) { o[k] = !!m[4 + i]; });
    return o;
  }
  /* What the print is drawn in: the design's own choice, else the place's default
     (Canada: mm and cm, French in Quebec; components/rp-canada.js). ca: the design's
     station or town is Canadian; prov: its two-letter province. */
  function locOf(s, ca, prov) {
    var d = ca && root.AgRpCanada ? root.AgRpCanada.defaultsFor(prov) : { units: 'in', lang: 'en' };
    return { units: s.units || d.units, lang: s.lang || d.lang };
  }

  /* Today's date in Chetek (America/Chicago), as YYYY-MM-DD. The year a reader
     may order as a gift is this date's year, so it never needs a code change. */
  function chicagoToday(now) {
    now = now || new Date();
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(now).forEach(function (x) { p[x.type] = x.value; });
      if (p.year && p.month && p.day) return p.year + '-' + p.month + '-' + p.day;
    } catch (e) {}
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  /* 'done': a finished year, drawn whole. 'gift': this year, drawn as a preview
     of the days recorded so far and ordered for delivery in January. 'future':
     nothing to draw. */
  function yearMode(year, todayIso) {
    var cy = parseInt(String(todayIso || chicagoToday()).slice(0, 4), 10);
    if (!year) return '';
    return year < cy ? 'done' : year === cy ? 'gift' : 'future';
  }
  /* The Christmas line on a product, from its cutoff date in data/rain-print.json.
     October 1 through the cutoff: "Order by Dec 12 for Christmas, if you OK the proof the day it comes."
     After it, through Dec 25: new orders ship after Christmas. Otherwise nothing.
     A plain date, never a countdown. */
  function cutoffNote(todayIso, cutoffIso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cutoffIso || ''));
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayIso || ''))) return '';
    if (todayIso < m[1] + '-10-01' || todayIso > m[1] + '-12-25') return '';
    if (todayIso <= cutoffIso) return 'Order by ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) + ' for Christmas, if you OK the proof the day it comes.';
    return 'Orders placed now ship after Christmas.';
  }
  /* CHRISTMAS DATES (2026-10-13). The last day to order and still have it by
     Dec 24, from the page's own promise in data/rain-print.json: Sig sends the
     proof within proof_business_days, the buyer OKs it within
     approve_business_days, the print ships within ship_business_days after
     that, and the carrier takes transit_business_days[product]. Business days
     skip weekends and any date in holidays. An order on a weekend starts the
     clock the next business day. print_christmas_cutoff and
     framed_christmas_cutoff in the same file must equal what this gives
     (test/rain-print-launch.test.mjs), so the promo line reads the right date.
     null when a number is missing. */
  /* USPS HOLIDAYS, COMPUTED (2026-10-17, chaos-5). The 11 federal holidays
     the Postal Service observes: New Year's Day, Martin Luther King Jr. Day,
     Washington's Birthday, Memorial Day, Juneteenth, Independence Day, Labor
     Day, Columbus Day, Veterans Day, Thanksgiving and Christmas. One that
     falls on a Saturday is observed the Friday before, on a Sunday the Monday
     after (5 U.S.C. 6103; Jan 1 2028 is a Saturday, so Dec 31 2027 is off).
     data/rain-print.json holidays adds any other closed day (an override),
     so the list in the file no longer has to be moved each year. */
  function uspsHolidays(y) {
    function iso(t) { return new Date(t).toISOString().slice(0, 10); }
    function nth(m, w, n) { var t = Date.UTC(y, m - 1, 1); t += ((w - new Date(t).getUTCDay() + 7) % 7) * 864e5; return t + (n - 1) * 7 * 864e5; }
    function last(m, w) { var t = Date.UTC(y, m, 0); return t - ((new Date(t).getUTCDay() - w + 7) % 7) * 864e5; }
    function obs(m, d) { var t = Date.UTC(y, m - 1, d), x = new Date(t).getUTCDay(); return x === 6 ? t - 864e5 : x === 0 ? t + 864e5 : t; }
    return [obs(1, 1), nth(1, 1, 3), nth(2, 1, 3), last(5, 1), obs(6, 19), obs(7, 4), nth(9, 1, 1), nth(10, 1, 2), obs(11, 11), nth(11, 4, 4), obs(12, 25)].map(iso);
  }
  /* The closed days around a date: computed for the year before through two
     years after, plus the file's own list. */
  function holidaysFor(j, iso) {
    var y = parseInt(String(iso || '').slice(0, 4), 10) || new Date().getUTCFullYear(), out = [];
    for (var k = y - 1; k <= y + 2; k++) out = out.concat(uspsHolidays(k));
    return out.concat(j && Array.isArray(j.holidays) ? j.holidays : []);
  }
  function isBizDay(iso, hol) { var d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d !== 0 && d !== 6 && (hol || []).indexOf(iso) < 0; }
  function addBizDays(iso, n, hol) {
    var t = Date.parse(iso + 'T12:00:00Z'), k = 0, cur = iso;
    while (k < n) { t += 86400000; cur = new Date(t).toISOString().slice(0, 10); if (isBizDay(cur, hol)) k++; }
    return cur;
  }
  function christmasCutoff(j, id, year) {
    var tr = j && j.transit_business_days && j.transit_business_days[id];
    var parts = [j && j.proof_business_days, j && j.approve_business_days, j && j.ship_business_days, tr];
    if (!parts.every(function (x) { return Number.isInteger(x) && x >= 0 && x < 40; })) return null;
    var n = parts.reduce(function (a, b) { return a + b; }, 0), by = year + '-12-24', hol = holidaysFor(j, by);
    var t = Date.parse(by + 'T12:00:00Z');
    for (var i = 0; i < 90; i++, t -= 86400000) {
      var d = new Date(t).toISOString().slice(0, 10);
      if (addBizDays(d, n, hol) <= by) return d;
    }
    return null;
  }
  /* WHEN IT ARRIVES (2026-10-16): the same sum the Christmas dates use (proof,
     the buyer's OK, ship, the mail, in business days from data/rain-print.json),
     counted forward from today. A birthday or an anniversary buyer needs the
     date as much as a Christmas one. '' when a number is missing. */
  function arriveBy(j, id, todayIso) {
    var tr = j && j.transit_business_days && j.transit_business_days[id];
    var parts = [j && j.proof_business_days, j && j.approve_business_days, j && j.ship_business_days, tr];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayIso || '')) || !parts.every(function (x) { return Number.isInteger(x) && x >= 0 && x < 40; })) return '';
    return addBizDays(todayIso, parts.reduce(function (a, b) { return a + b; }, 0), holidaysFor(j, todayIso));
  }
  function shortDate(iso) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[1] - 1] + ' ' + (+m[2]) : ''; }

  /* THE BUSINESS PAGE'S CHRISTMAS SENTENCE (2026-10-17, chaos-6), tied to the
     same dates as the gift line: through business_cutoff, send the list by
     then; after it, through the print cutoff, ask (a small list can still
     make it); after that, through Dec 25, plainly after Christmas; outside
     Oct 1 to Dec 25 of the cutoff's year, no Christmas clause at all. */
  /* A LIST THAT DOESN'T ADD UP (2026-10-17, farm-buyers panel: 30 prints and
     3 towns sent with no question). From 10 prints, a list with more than one
     line but fewer lines than prints, none saying "all", "each", "every" or a
     count like "x 10", asks once before sending. A header row ("Town, State,
     Year") is not a town. '' when the list looks right. Pure: the tests run it. */
  function bizTownCheck(qn, towns) {
    var lines = String(towns || '').split(/\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^(town|place|city)\b/i.test(l); });
    if (!(qn >= 10) || lines.length < 2 || lines.length >= qn) return '';
    if (lines.some(function (l) { return /\b(all|each|every|both)\b|\b[x\u00d7]\s*\d+\b|\b\d+\s*[x\u00d7]\b|\b\d+\s*(copies|prints|of them)\b/i.test(l); })) return '';
    return qn + ' prints and ' + lines.length + ' towns: is one town for several? Say how many go with each (like "Chetek, WI, 2012, x 10"), or press Send again to send it as it is.';
  }
  function bizChristmasLine(todayIso, j) {
    var t = String(todayIso || ''), bc = j && j.business_cutoff, pc = j && j.print_christmas_cutoff, M = /^(\d{4})-(\d{2})-(\d{2})$/;
    var tail = ' Last year, or a year your customers still talk about, works well.';
    var plain = 'Any past year ships within ' + ((j && j.ship_business_days) || 3) + ' business days after you OK the proof sheet.' + tail;
    var m = M.exec(String(bc || ''));
    if (!M.test(t) || !m || t < m[1] + '-10-01' || t > m[1] + '-12-25') return plain;
    if (t <= bc) return 'Any past year ships before Christmas if the list comes in time: send it by ' + shortDate(bc) + '.' + tail;
    if (M.test(String(pc || '')) && t <= pc) return 'The ' + shortDate(bc) + ' list date has passed. A small list may still make Christmas if it is in by ' + shortDate(pc) + ': ask me for dates.' + tail;
    return 'Orders placed now arrive after Christmas.' + tail;
  }
  /* FOR BUSINESSES (2026-10-12). The list cutoff line, from business_cutoff in
     data/rain-print.json: "For Christmas, send your list by Nov 20." through
     that date; nothing after it, or while it is null. */
  function bizCutoffNote(todayIso, cutoffIso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cutoffIso || ''));
    if (!m || +m[2] < 1 || +m[2] > 12 || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayIso || '')) || todayIso > cutoffIso) return '';
    return 'For Christmas, send your list by ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) + '.';
  }
  /* Business prices, all from data/rain-print.json (Sig, 2026-10-13): one
     price per print, delivered, like the cards. business_tiers
     [{min, print12x18, framed12x18}] in dollars a print, shipping included;
     business_one_address_off {print12x18, framed12x18} dollars off each print
     when the whole order goes to one address; business_quote_max the most
     prints the table and quote line price (above it Sig quotes it himself).
     A digital file is the digital price at any quantity. A business order is
     BIZ_MIN to BIZ_MAX prints (the worker checks the same). No usable tier:
     no rows, so the page shows no table and the quote line says Sig quotes it.
     Every figure is rounded to the cent. */
  var BIZ_PRODUCTS = ['print12x18', 'framed12x18', 'digital'];
  var BIZ_SHIPPED = ['print12x18', 'framed12x18'];
  var BIZ_MIN = 5, BIZ_MAX = 500;
  function cents(x) { return Math.round(x * 100) / 100; }
  function bizTiers(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).filter(function (t) {
      var ok = t && Number.isInteger(t.min) && t.min >= BIZ_MIN && t.min <= BIZ_MAX && !seen[t.min] &&
        BIZ_SHIPPED.every(function (id) { return typeof t[id] === 'number' && t[id] > 0; });
      if (ok) seen[t.min] = 1;
      return ok;
    }).sort(function (a, b) { return a.min - b.min; });
  }
  function bizPricesOk(j) { return !!j && BIZ_PRODUCTS.every(function (id) { return typeof j[id] === 'number' && j[id] > 0; }); }
  /* The most prints the page prices: business_quote_max when it is a whole
     number from the last tier's min to BIZ_MAX, else BIZ_MAX. */
  function bizQuoteMax(j, tiers) {
    var m = j && j.business_quote_max, lo = tiers.length ? tiers[tiers.length - 1].min : BIZ_MIN;
    return Number.isInteger(m) && m >= lo && m <= BIZ_MAX ? m : BIZ_MAX;
  }
  /* Dollars off each print shipped all to one address, per product (0 when unset). */
  function bizOff(j) {
    var o = j && j.business_one_address_off, out = {};
    BIZ_SHIPPED.forEach(function (id) { var v = o && typeof o === 'object' ? o[id] : 0; out[id] = typeof v === 'number' && v >= 0 ? v : 0; });
    return out;
  }
  /* The table: one row per tier, from its min to the next tier's min less one
     (the last runs to the quote max). Each row: {from, to, retail, prices, one},
     retail true when both prices are the cards' prices: no discount, so no
     one-address discount on that row either. */
  function bizRows(j) {
    if (!bizPricesOk(j)) return [];
    var tiers = bizTiers(j.business_tiers), max = bizQuoteMax(j, tiers), off = bizOff(j);
    return tiers.filter(function (t) { return t.min <= max; }).map(function (t, i, all) {
      var r = { from: t.min, to: i + 1 < all.length ? all[i + 1].min - 1 : max, retail: true, prices: {}, one: {} };
      BIZ_SHIPPED.forEach(function (id) {
        r.prices[id] = cents(t[id]);
        r.one[id] = cents(Math.max(0, t[id] - off[id]));
        if (t[id] !== j[id]) r.retail = false;
      });
      // a tier at the card prices is "no discount": no one-address discount either (Sig, 2026-10-13)
      if (r.retail) r.one = { print12x18: r.prices.print12x18, framed12x18: r.prices.framed12x18 };
      return r;
    });
  }
  function bizRowFor(rows, qty) {
    for (var i = 0; i < (rows || []).length; i++) if (qty >= rows[i].from && qty <= rows[i].to) return rows[i];
    return null;
  }
  /* One product, one quantity, one destination ('one' all to one address,
     anything else one to each customer): {unit, total}, delivered;
     total = unit x qty, to the cent. null outside BIZ_MIN to the quote max,
     or with no tier for that quantity (Sig quotes it). */
  function bizQuote(j, qty, id, dest) {
    if (!bizPricesOk(j) || BIZ_PRODUCTS.indexOf(id) < 0 || !Number.isInteger(qty) || qty < BIZ_MIN || qty > BIZ_MAX) return null;
    var unit;
    if (id === 'digital') {
      if (qty > bizQuoteMax(j, bizTiers(j.business_tiers))) return null;
      unit = cents(j.digital);
    } else {
      var r = bizRowFor(bizRows(j), qty);
      if (!r) return null;
      unit = dest === 'one' ? r.one[id] : r.prices[id];
    }
    return { unit: unit, total: Math.round(Math.round(unit * 100) * qty) / 100 };
  }
  /* ORDERS FROM CANADA (2026-10-16). data/rain-print.json "canada" holds the one
     switch: ships (true opens prints and framed prints to Canadian addresses).
     Until then a Canadian design orders the digital file only (no shipping, the
     same price and checkout), and the print cards say so. With ships on, the
     prices are canada.print12x18 / framed12x18 (US dollars, delivered; null keeps
     the US price), the checkout is canada.payment_links (null: the order request
     form, which emails Sig), and the shipping line, transit days and Christmas
     dates are Canada's own (no Christmas date unless canada sets one).
     -> the prices object the order step reads, and blocked: the products a
     Canadian design can't order yet. */
  function orderPrices(prices, ca) {
    if (!prices || !ca) return { j: prices, blocked: [] };
    var c = prices.canada || {}, j = Object.assign({}, prices), links = prices.payment_links || {};
    j.print_christmas_cutoff = null; j.framed_christmas_cutoff = null;
    if (c.ships !== true) return { j: j, blocked: ['print12x18', 'framed12x18'] };
    var cl = c.payment_links || {};
    j.payment_links = { digital: links.digital || null, print12x18: cl.print12x18 || null, framed12x18: cl.framed12x18 || null };
    ['print12x18', 'framed12x18'].forEach(function (id) { if (typeof c[id] === 'number' && c[id] > 0) j[id] = c[id]; });
    if (c.transit_business_days) j.transit_business_days = c.transit_business_days;
    if (c.ships_within) j.ships_within = c.ships_within;
    if (c.print_christmas_cutoff) j.print_christmas_cutoff = c.print_christmas_cutoff;
    if (c.framed_christmas_cutoff) j.framed_christmas_cutoff = c.framed_christmas_cutoff;
    return { j: j, blocked: [] };
  }
  function bizRange(r) { return r.to === null ? r.from + ' or more' : r.from === r.to ? String(r.from) : r.from + '\u2013' + r.to; }
  /* Index of the last day with a reading of its own (v not null and not an S
     day), or -1. A preview ends there: the days after it are not in yet, not
     dry. Trailing S days are not in yet either: their catch arrives with a
     later A total that has not been reported. */
  function lastRecorded(days) {
    for (var i = (days || []).length - 1; i >= 0; i--) if (days[i] && days[i].v !== null && days[i].v !== undefined && days[i].flag !== 'S') return i;
    return -1;
  }

  // ---------- the year's numbers (pure: the tests run these) ----------
  var MISS_OK = 10;      // auto station pick: first of the nearest three with at most this many unrecorded days
  var DRY_MIN = 7;       // a dry spell is marked on the art, on either layout, only at this many days or more
  var f2 = function (x) { return x.toFixed(2); };
  /* One ACIS daily value. M: not recorded. T: a trace (counts as 0, ends a
     dry run). S: the observer did not read the gauge that day; its catch is in
     the next "A" value (an accumulated total over several days). v stays 0 on
     an S day so the year's total counts that catch once, on the day the A total
     was reported, but an S day is not a dry day and not a measured 0. */
  function parsePcpn(raw) {
    var s = String(raw).trim();
    if (s === 'M') return { v: null, flag: 'M' };
    if (s === 'T') return { v: 0, flag: 'T' };
    if (s === 'S') return { v: 0, flag: 'S' };
    var v = parseFloat(s);
    if (isNaN(v)) return { v: null, flag: 'M' };
    return { v: v, flag: /A$/.test(s) ? 'A' : '' };
  }
  /* A snowfall value of T: snow fell that day, too little to measure (under 0.1 in). Its own
     flag on the day (sT), never the precipitation trace (flag 'T', counted in derive's D.trace):
     a snowfall trace can fall on a day with measured rain, or a day the gauge read T or 0.
     Not June 1 to August 31 by the day's date (iso, YYYY-MM-DD; Sig, 2026-10-20: "skip summer
     traces"): a summer T is most likely hail logged as snow (Grand Forks ND, Jun 3 2026, on the
     year's biggest rain). US and Canada only, so one season. A measured summer snow amount stays. */
  function snowTraceRaw(raw, iso) {
    if (raw === undefined || raw === null || String(raw).trim() !== 'T') return false;
    var mo = iso ? +String(iso).slice(5, 7) : 0;
    return !(mo >= 6 && mo <= 8);
  }
  // A day whose own amount nobody knows: unrecorded, or rolled into a later A total.
  function unknownDay(x) { return x.v === null || x.v === undefined || x.flag === 'S'; }
  /* Snowfall over the year's days: {miss: reported days with no snowfall value,
     tot: inches}. A day with no precipitation report is already a gap; it doesn't
     also count against snowfall (panel 3 D2). In a year still going (the days end
     before Dec 31), the days after the station's last snowfall value are not
     counted as missing: those values have not come in yet, as the rain's own
     trailing days have not (2026-10-19: Eagle River WI, 70.0 in of snow, missed
     only Oct 1 to 13 and one March day, and drew none). The same count serves
     derive and snowStateOf, and scripts/build_county_rain.py print_snow mirrors it. */
  function snowCount(days) {
    days = days || [];
    var n = days.length, end = n, last = n ? String(days[n - 1] && days[n - 1].date || '') : '';
    var has = function (x) { return x && x.s !== null && x.s !== undefined; };
    if (last && !/-12-31$/.test(last)) {
      var k = n - 1;
      while (k >= 0 && !has(days[k])) k--;
      if (k >= 0) end = k + 1;
    }
    var miss = 0, tot = 0;
    for (var i = 0; i < end; i++) {
      var x = days[i];
      if (!x || x.v === null || x.v === undefined) continue;
      if (has(x)) tot += x.s; else miss++;
    }
    return { miss: miss, tot: tot };
  }
  function derive(days) {
    var n = days.length, month = Array(12).fill(0), mdays = Array(12).fill(0), monthValid = Array(12).fill(0);
    var total = 0, wet = 0, missing = 0, trace = 0, unsplit = 0, max = { v: 0, date: '', doy: -1 }, maxRain = { v: 0, date: '', doy: -1 };
    var sRun = 0, accDay = 0;   // S days in a row so far; the smallest biggest day any A total proves
    var dry = 0, dryStart = -1, dryMax = { len: 0, end: '', endDoy: -1, startDoy: -1 }, cum = [], over1 = 0;
    function endDry() { dry = 0; dryStart = -1; }
    days.forEach(function (x) {
      mdays[x.m]++;
      // An unrecorded day ends a dry run: nobody knows whether it rained.
      if (x.v === null || x.v === undefined) { missing++; sRun = 0; endDry(); cum.push(total); return; }
      monthValid[x.m]++;
      // An S day is the same: its rain was real, but it is counted on the A day.
      if (x.flag === 'S') { unsplit++; sRun++; endDry(); cum.push(total); return; }
      /* An A total covers its S days and itself. However it split, one of those
         days had at least total / days, so a single day that small or smaller
         cannot be called the year's biggest. */
      if (x.flag === 'A') accDay = Math.max(accDay, x.v / (sRun + 1));
      sRun = 0;
      if (x.flag === 'T') { trace++; endDry(); cum.push(total); return; }
      total += x.v; month[x.m] += x.v; cum.push(total);
      if (x.v >= 1) over1++;
      if (x.v > 0) {
        wet++; endDry();
        // An A value is several days' catch, so it cannot be the wettest single day.
        if (x.flag !== 'A' && x.v > max.v) max = { v: x.v, date: x.date, doy: x.doy };
        // The biggest rain: a plain reading on a day with no snow (Sig: rain days only).
        if (x.flag === '' && !(x.s > 0) && x.v > maxRain.v) maxRain = { v: x.v, date: x.date, doy: x.doy };
      }
      else if (x.s > 0) endDry();   // snow fell: not a dry day, whatever the gauge read (Sig)
      else { if (dry === 0) dryStart = x.doy; dry++; if (dry > dryMax.len) dryMax = { len: dry, end: x.date, endDoy: x.doy, startDoy: dryStart }; }
    });
    // Withheld, not guessed, when an A total proves some day beat it.
    var accR = Math.round(accDay * 100) / 100, none = function () { return { v: 0, date: '', doy: -1 }; };
    if (accR > max.v) max = none();
    if (accR > maxRain.v) maxRain = none();
    var validMonths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(function (i) { return monthValid[i] > 0; });
    var maxMonth = validMonths.length ? Math.max.apply(null, validMonths.map(function (i) { return month[i]; })) : 0;
    var maxDay = Math.max.apply(null, [0].concat(days.map(function (x) { return x.v || 0; })));
    // Snowfall prints only when the station kept a snowfall record nearly every day
    // (at most MISS_OK days without one) and some snow fell; otherwise it is left off.
    var sc = snowCount(days), snowTotal = sc.tot, snowMissing = sc.miss;
    var snow = snowMissing <= MISS_OK && snowTotal >= 0.1 ? Math.round(snowTotal * 10) / 10 : null;
    var hot = { v: null, date: '', doy: -1 }, cold = { v: null, date: '', doy: -1 };
    days.forEach(function (x) {
      if (x.t === null || x.t === undefined) return;
      if (hot.v === null || x.t > hot.v) hot = { v: x.t, date: x.date, doy: x.doy };
      if (cold.v === null || x.t < cold.v) cold = { v: x.t, date: x.date, doy: x.doy };
    });
    return { n: n, month: month, mdays: mdays, monthValid: monthValid, total: total, wet: wet, missing: missing, unsplit: unsplit, trace: trace, max: max, maxRain: maxRain, dryMax: dryMax, cum: cum, maxMonth: maxMonth, maxDay: maxDay, over1: over1, hot: hot, cold: cold, snow: snow };
  }
  /* A run of S days that no A total closes (the next day is missing, a plain
     reading, or the year ends) has its catch nowhere in the record, so those
     days are missing days, not days counted later. Returns a new array. */
  function closeOpenS(days) {
    var out = (days || []).map(function (x) { return x; });
    for (var i = 0; i < out.length; i++) {
      if (!out[i] || out[i].flag !== 'S') continue;
      var j = i;
      while (j < out.length && out[j] && out[j].flag === 'S') j++;
      if (!(j < out.length && out[j] && out[j].flag === 'A')) {
        for (var k = i; k < j; k++) out[k] = Object.assign({}, out[k], { v: null, flag: 'M' });
      }
      i = j - 1;
    }
    return out;
  }
  // the same rule on both layouts
  function showDry(D) { return D.dryMax.len >= DRY_MIN; }
  /* A STUCK GAUGE (2026-10-14, panel 3 D1). STUCK_DAYS or more days in a row
     reported as 0.00 (not missing, not a trace, no snow), over a stretch whose
     30-year normal adds up to STUCK_USUAL inches or more, is not a drought a
     station records: the gauge was likely stuck. The print then makes no claim
     from it (no dry stretch, no remarkable days) and the page says why. In wet
     country 60 days of zeros against 4 in of normal doesn't happen; desert and
     dry-season normals stay under 4 in, so they never trip it.
     byDate: Map of 'MM-DD' -> normal inches. -> {from, to, n, usual} | null */
  var STUCK_DAYS = 60, STUCK_USUAL = 4.0;
  function stuckRun(days, byDate) {
    if (!byDate || !days || !byDate.size) return null;
    var zero = function (x) { return x && x.flag === '' && x.v === 0 && !(x.s > 0); };
    var best = null, i = 0;
    while (i < days.length) {
      if (!zero(days[i])) { i++; continue; }
      var j = i, usual = 0;
      while (j < days.length && zero(days[j])) { usual += byDate.get(days[j].date.slice(5)) || 0; j++; }
      if (j - i >= STUCK_DAYS && usual >= STUCK_USUAL && (!best || usual > best.usual)) best = { from: days[i].date, to: days[j - 1].date, n: j - i, usual: Math.round(usual * 100) / 100 };
      i = j;
    }
    return best;
  }
  /* The comparison's daily amounts, aligned to the year. `normal` is the
     comparison as it is; `daily` (what the running total, band and headline
     use) is 0 on a day the station did not record, since the year's total has
     nothing for that day either. An S day keeps its normal: its rain is in the
     year's total, on the A day. Null when the comparison has no dates at all. */
  function overlayDaily(days, byDate) {
    var none = 0, normal = [], daily = [];
    days.forEach(function (x) {
      var v = byDate.get(x.date.slice(5));
      if (v === undefined) { none++; v = 0; }
      normal.push(v);
      daily.push(x.v === null || x.v === undefined ? 0 : v);
    });
    if (none === days.length) return null;
    var cum = [], run = 0;
    daily.forEach(function (v) { run += v; cum.push(run); });
    return { normal: normal, daily: daily, cum: cum, total: run };
  }
  /* Staircase trace: a point at the end of each day at that day's running
     total. The pen lifts across a day with no amount of its own (missing or S),
     so a gap never reads as a dry step, and comes down again at the start of
     the next known day, at the total before it. */
  function stairPath(days, cum, x0, y1, w, k) {
    var d = 'M' + x0 + ',' + y1, pen = true;
    days.forEach(function (x) {
      if (unknownDay(x)) { pen = false; return; }
      if (!pen) { d += 'M' + f2(x0 + x.doy * w) + ',' + f2(y1 - (x.doy > 0 ? cum[x.doy - 1] : 0) * k); pen = true; }
      d += 'L' + f2(x0 + (x.doy + 1) * w) + ',' + f2(y1 - cum[x.doy] * k);
    });
    return d;
  }
  // The wettest day's red riser runs from the running total before that day
  // (0 on Jan 1) to the total after it.
  function riserSpan(D) {
    if (!(D.max.v > 0) || D.max.doy < 0) return null;
    return [D.max.doy > 0 ? D.cum[D.max.doy - 1] : 0, D.cum[D.max.doy]];
  }

  function utf8b64url(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlUtf8(code) {
    var b = String(code).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  /* Design code v2 (2026-10-13): base64url of
     "2|place|station|year|LPCSX|name|day|label|day|label|day|label|dedication"
     (L P C S = one letter each for layout, palette, comparison, size; X = a to h,
     the style and two switches in one letter: +4 for R2, +1 for the 30-year
     normals shown, +2 for remarkable days; day = day of the year in base 36; the
     dedication only when there is one, so the field count says whether it is
     there). Every byte counts: the longest design's link still has to fit the QR
     stamp when no short link can be had. A v1 code ("1|...|LPCS|name|day|label...")
     still opens: as R1, or R2 if its layout was Waveform. A logo (2026-10-14)
     adds 13 letters to the key field: i (the print's ink) or c (its own colors)
     and the 12-letter id, so LPCSX becomes LPCSXi<id>. Units and language (2026-10-16, Canada) add one
     capital letter at the end of the key field when either is chosen (LOCF: A to H for the eight pairs
     besides "the place's default for both"), so a plain US code is exactly as before. Only the characters A-Z a-z 0-9 - _ so Stripe takes it
     as a client_reference_id (200 at most).
     A gift order (this year, delivered in January) is the same code with GIFT-
     in front, so Sig sees it in Stripe without decoding anything. A v1 code
     always starts with M (base64 of "1|"), so the prefix cannot be mistaken
     for part of a code. */
  var GIFT_PREFIX = 'GIFT-', XFLAG = 'abcdefgh', LOCF = 'ABCDEFGH', LOC_U = ['', 'in', 'mm'], LOC_L = ['', 'en', 'fr'];
  function locLetter(s) { var k = LOC_U.indexOf(s.units) * 3 + LOC_L.indexOf(s.lang); return k > 0 ? LOCF[k - 1] : ''; }
  function encodeCode(x) {
    var s = normalize(x);
    if (!s.place || !s.year) return '';
    var x5 = XFLAG[(s.style === 'r2' ? 4 : 0) + (s.normals ? 1 : 0) + (s.records ? 2 : 0)];
    var f = ['2', s.place, s.station, String(s.year), LAYOUT[s.layout] + PALETTE[s.palette] + CMP[s.cmp] + SIZE[s.size] + x5 +
      (s.logo ? (s.logoInk ? 'i' : 'c') + s.logo : '') + locLetter(s) + optCode(s), s.name];
    s.markers.forEach(function (m) { f.push(dayIndex(s.year, m.date).toString(36), m.label); });
    while (f.length > 6 && f[f.length - 1] === '' && f[f.length - 2] === '') f.length -= 2;
    if (s.dedication) f.push(s.dedication);
    return (s.gift ? GIFT_PREFIX : '') + utf8b64url(f.join('|'));
  }
  function decodeCode(code) {
    code = String(code || '');
    var gift = code.indexOf(GIFT_PREFIX) === 0;
    if (gift) code = code.slice(GIFT_PREFIX.length);
    if (!/^[A-Za-z0-9_-]{8,400}$/.test(code)) return null;
    var raw;
    try { raw = b64urlUtf8(code); } catch (e) { return null; }
    var f = raw.split('|'), v2 = f[0] === '2', ded = '';
    if ((f[0] !== '1' && !v2) || f.length < 6) return null;
    if (v2 && (f.length - 6) % 2) { ded = f.pop(); if (!ded) return null; }
    if ((f.length - 6) % 2) return null;
    var k = f[4] || '', x5 = v2 ? XFLAG.indexOf(k[4]) : -1, logo = '', logoInk = true, units = '', lang = '', opt = {};
    // the 2026-10-17 options ride at the end of the key field after a ~ (a code made before them has none)
    var ti = v2 ? k.indexOf('~') : -1;
    if (ti >= 0) { opt = optDecode(k.slice(ti + 1), parseInt(f[3], 10)); if (!opt) return null; k = k.slice(0, ti); }
    if (v2 && (k.length === 6 || k.length === 19) && LOCF.indexOf(k[k.length - 1]) >= 0) {
      var li = LOCF.indexOf(k[k.length - 1]) + 1;
      units = LOC_U[Math.floor(li / 3)]; lang = LOC_L[li % 3];
      k = k.slice(0, -1);
    }
    if (v2 && k.length === 18) {
      logo = cleanLogo(k.slice(6));
      if (!logo || logo !== k.slice(6) || 'ic'.indexOf(k[5]) < 0) return null;
      logoInk = k[5] === 'i';
      k = k.slice(0, 5);
    }
    if (k.length !== (v2 ? 5 : 4) || !LAYOUT_R[k[0]] || !PALETTE_R[k[1]] || !CMP_R[k[2]] || !SIZE_R[k[3]]) return null;
    if (v2 && x5 < 0) return null;
    var year = parseInt(f[3], 10);
    if (!(year >= 1850 && year <= 2200) || String(year) !== f[3]) return null;
    var markers = [];
    for (var i = 6; i + 1 < f.length; i += 2) {
      var doy = parseInt(f[i], 36);
      var iso = isoFromDay(year, doy);
      if (!iso) return null;
      markers.push({ date: iso, label: f[i + 1] });
    }
    var s = normalize({ place: f[1], station: f[2], year: year, layout: LAYOUT_R[k[0]], palette: PALETTE_R[k[1]],
      cmp: CMP_R[k[2]], size: SIZE_R[k[3]], name: f[5], markers: markers, gift: gift,
      style: v2 ? (x5 & 4 ? 'r2' : 'r1') : null, dedication: ded, normals: v2 && (x5 & 1) === 1, records: v2 && (x5 & 2) === 2,
      logo: logo, logoInk: logoInk, units: units, lang: lang,
      crop: opt.crop, cropPlant: opt.cropPlant, cropHarvest: opt.cropHarvest, plants: opt.plants, ghost: opt.ghost, hist: opt.hist, frost: opt.frost, heat: opt.heat, ribbon: opt.ribbon });
    return s.place ? s : null;
  }

  function toParams(x) {
    var s = normalize(x), q = new URLSearchParams();
    if (s.place) q.set('place', s.place);
    if (s.year) q.set('year', String(s.year));
    if (s.station) q.set('station', s.station);
    q.set('layout', s.layout);
    q.set('palette', s.palette);
    q.set('size', s.size);
    if (s.cmp !== 'none') q.set('cmp', s.cmp);
    q.set('style', s.style);
    if (s.name) q.set('name', s.name);
    if (s.dedication) q.set('dedication', s.dedication);
    if (s.normals) q.set('normals', '1');
    if (s.records) q.set('records', '1');
    if (s.logo) { q.set('logo', s.logo); q.set('logoInk', s.logoInk ? '1' : '0'); }
    if (s.units) q.set('u', s.units);
    if (s.lang) q.set('lang', s.lang);
    if (s.crop) { q.set('crop', s.crop); q.set('plant', s.cropPlant); q.set('harvest', s.cropHarvest); }
    OPT_FLAGS.forEach(function (k) { if (s[k]) q.set(k, '1'); });
    s.markers.forEach(function (m, i) { q.set('m' + (i + 1), m.date + (m.label ? ' ' + m.label : '')); });
    if (s.gift) q.set('gift', '1');
    return q.toString();
  }
  function fromParams(search) {
    var q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    if (q.get('d')) { var c = decodeCode(q.get('d')); if (c) return c; }
    var markers = [];
    for (var i = 1; i <= LIMITS.markers; i++) {
      var v = q.get('m' + i);
      if (v) markers.push({ date: v.slice(0, 10), label: v.slice(10).trim() });
    }
    /* A link the tool made always carries style= (toParams) and comes in as it was
       made. A link written by hand (the story links, county rain pages, an email)
       has no style= and gets a new visitor's defaults: compared with the 30-year
       normal, the normals shown and the remarkable days on (Sig, 2026-10-15),
       unless the link says cmp=, normals=0 or records=0. The normals go with the
       30-year comparison only, as the boxes do: a hand link with cmp=station or
       cmp=none leaves them off unless it says normals=1. */
    var hand = !q.get('style'), cmp = q.get('cmp') || (hand ? 'normal' : null);
    var dflt = function (k, on) { var v = q.get(k); return v === null ? (hand && on ? '1' : null) : v; };
    return normalize({ place: q.get('place'), station: q.get('station'), year: q.get('year'), layout: q.get('layout'),
      palette: q.get('palette'), size: q.get('size'), cmp: cmp, name: q.get('name'), markers: markers, gift: q.get('gift'),
      style: q.get('style'), dedication: q.get('dedication'), normals: dflt('normals', cmp === 'normal'), records: dflt('records', true),
      logo: q.get('logo'), logoInk: q.get('logoInk'), units: q.get('u'), lang: q.get('lang'),
      // the options: a hand link gets a new visitor's frost marks and hottest and coldest day; a tool link as it was made
      crop: q.get('crop'), cropPlant: q.get('plant'), cropHarvest: q.get('harvest'), plants: q.get('plants'), ghost: q.get('ghost'), hist: q.get('hist'),
      frost: dflt('frost', true), heat: dflt('heat', true), ribbon: q.get('ribbon') });
  }
  // URLSearchParams leaves * as it is, and the worker's design_url rule has no * (2026-10-14, panel 3)
  function designUrl(x) { return SITE + '?' + String(toParams(x)).replace(/\*/g, '%2A'); }
  function shortUrl(x) { var c = encodeCode(x); return c ? SITE + '?d=' + c : SITE; }

  // ---------- places (pure: the tests run these) ----------
  var STATE = {wi:'wisconsin',mn:'minnesota',ia:'iowa',il:'illinois',mi:'michigan',nd:'north dakota',sd:'south dakota',ne:'nebraska',ks:'kansas',mo:'missouri',in:'indiana',oh:'ohio',ky:'kentucky',tn:'tennessee',tx:'texas',ok:'oklahoma',co:'colorado',mt:'montana',wy:'wyoming',id:'idaho',wa:'washington',or:'oregon',ca:'california',nv:'nevada',ut:'utah',az:'arizona',nm:'new mexico',ar:'arkansas',la:'louisiana',ms:'mississippi',al:'alabama',ga:'georgia',fl:'florida',sc:'south carolina',nc:'north carolina',va:'virginia',wv:'west virginia',pa:'pennsylvania',ny:'new york',nj:'new jersey',ct:'connecticut',ri:'rhode island',ma:'massachusetts',vt:'vermont',nh:'new hampshire',me:'maine',md:'maryland',de:'delaware',ak:'alaska',hi:'hawaii',dc:'district of columbia',pr:'puerto rico'};
  function abbrFor(full) { for (var k in STATE) if (STATE[k] === full) return k.toUpperCase(); return null; }
  function toTitle(s) { return String(s).split(' ').map(function (w) { return /\d/.test(w) ? w : (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w); }).join(' '); }
  function haversine(a, b, c, d) { var R = 6371, t = function (x) { return x * Math.PI / 180; }, h = Math.pow(Math.sin(t(c - a) / 2), 2) + Math.cos(t(a)) * Math.cos(t(c)) * Math.pow(Math.sin(t(d - b) / 2), 2); return 2 * R * Math.asin(Math.sqrt(h)); }
  /* The town lookup (Open-Meteo, US only). A plain town with no state that
     matches towns in more than one place comes back as {pick: [...]} so the page
     can ask which one; a town and state that match nothing in that state is an
     error, not the first town of that name somewhere else. Five digits are sent
     as a ZIP code (Open-Meteo matches postal codes); the town found is what the
     print and the order then name. */
  function placeLabel(x) { return x.name + ', ' + (abbrFor(String(x.admin1 || '').toLowerCase()) || x.admin1 || ''); }
  function geocodeQuery(q) {
    q = String(q || '');
    var zip = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(q);
    var parts = q.split(','), town = zip ? zip[1] : parts[0].trim(), st = zip ? '' : (parts[1] || '').trim().toLowerCase();
    // no comma: a trailing state name or postal code is the state ("Ames Iowa", "Ames IA", "Springfield IL", 2026-10-15)
    if (!zip && parts.length === 1) { var t = trailingState(town); if (t) { town = t.town; st = t.st; } }
    return { zip: zip ? zip[1] : '', town: town, st: st };
  }
  function trailingState(s) {
    var w = String(s).trim().split(/\s+/);
    for (var n = Math.min(3, w.length - 1); n >= 1; n--) {
      var tail = w.slice(w.length - n).join(' ').toLowerCase().replace(/\.$/, ''), head = w.slice(0, w.length - n).join(' ');
      if (n === 1 && /^[a-z]{2}$/.test(tail) && STATE[tail]) return { town: head, st: tail };
      for (var k in STATE) if (STATE[k] === tail) return { town: head, st: k };
    }
    return null;
  }
  function geoPick(q, results) {
    var g = geocodeQuery(q), list = (results || []).filter(function (x) { return x && typeof x.latitude === 'number' && typeof x.longitude === 'number' && x.name; });
    if (!list.length) return { error: g.zip ? 'Couldn\u2019t find ZIP ' + g.zip + '. Type the town and state instead, like Chetek, WI.' : 'Couldn\u2019t find \u201c' + q + '\u201d. Check the spelling, and type a town and state, like Chetek, WI.' };
    if (g.zip) return { hit: list[0] };
    if (g.st) {
      var inSt = list.filter(function (x) { var a = String(x.admin1 || '').toLowerCase(); return a === STATE[g.st] || a === g.st; });
      if (!inSt.length) return { error: 'Couldn\u2019t find \u201c' + g.town + '\u201d in ' + (STATE[g.st] ? toTitle(STATE[g.st]) : g.st.toUpperCase()) + '. Check the spelling of the town and the state.' };
      list = inSt;
    }
    // more than one town of that name, far enough apart to have different gauges: ask
    var far = list.filter(function (x, i) { return i === 0 || haversine(list[0].latitude, list[0].longitude, x.latitude, x.longitude) > 30; });
    if (far.length > 1) return { pick: far.slice(0, 6) };
    return { hit: list[0] };
  }
  function parts0(q) { return String(q).split(',')[0].trim(); }
  /* A county rain page links here with the station's town, and some station
     names carry a field or farm name ("Topeka Billard, KS"). When that finds
     nothing, try the town with its last words dropped, longest first. */
  function shorterPlaces(q) {
    var g = geocodeQuery(q);
    if (g.zip || !g.st) return [];
    var w = g.town.split(/\s+/).filter(Boolean), out = [];
    for (var n = w.length - 1; n >= 1; n--) out.push(w.slice(0, n).join(' ') + ', ' + g.st.toUpperCase());
    return out;
  }

  /* The reader's dates, checked against the year: [{i, kind, msg}] for each date
     that won't print (2026-10-13: a date outside the year was dropped from the
     print with no word). Plain words, never a machine date (panel 5,
     2026-10-15: "Date 2 (2025-02-31) isn't in 2025" blamed the year).
     kind: 'day' (no such day in that month), 'year' (another year's date),
     'same' (two days on one date: both print, one over the other). */
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthDays(year, mo) { return new Date(Date.UTC(year || 2001, +mo, 0)).getUTCDate(); }
  // "February has 28 days in 2025. Pick a day from 1 to 28." or '' when the day is in the month
  function dayProblem(year, mo, dy) {
    mo = +mo; dy = +dy;
    if (!year || !mo || !dy) return '';
    var n = monthDays(year, mo);
    if (dy <= n) return '';
    if (mo === 2 && dy === 29) return year + ' has no February 29. Pick Feb 28 or Mar 1.';
    return MONTH_NAMES[mo - 1] + ' has ' + n + ' days' + (mo === 2 ? ' in ' + year : '') + '. Pick a day from 1 to ' + n + '.';
  }
  function dateProblems(year, dates) {
    var out = [];
    (dates || []).forEach(function (d, i) {
      if (!d || !year) return;
      if (dayIndex(year, d) >= 0) return;
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
      if (!m) return;
      var bad = dayProblem(+m[1], m[2], m[3]);
      if (bad) out.push({ i: i, kind: 'day', msg: bad });
      else out.push({ i: i, kind: 'year', msg: shortDate(d) + ', ' + m[1] + ' isn\u2019t in ' + year + ', so it won\u2019t be on the print. Pick a day in ' + year + '.' });
    });
    var seen = {};
    (dates || []).forEach(function (d, i) { if (d && dayIndex(year, d) >= 0) { if (seen[d] !== undefined) out.push({ i: i, kind: 'same', msg: 'Days ' + (seen[d] + 1) + ' and ' + (i + 1) + ' are both ' + shortDate(d) + '. Pick another day for one of them.' }); else seen[d] = i; } });
    return out;
  }
  // label ideas offered under the date boxes; any words of the buyer's own work too
  var LABEL_PRESETS = ['Planted', 'Harvest done', 'Turnout', 'Calving', 'Weaning', 'First cutting', 'Hail', 'Wedding', 'Born', 'Moved in', 'First frost', 'Anniversary', 'Retired'];

  /* What goes to Stripe as client_reference_id (A-Z a-z 0-9 - _, at most 200):
     the design code itself when it fits; past that (a long place, name, line
     and labels) the short-link id the QR already carries, as RPS-<id>, with
     GIFT- in front for this year's January gift. '' when neither fits, and the
     page opens the order form instead (2026-10-13: a long design used to have
     no way to pay). shortLink is 'HTTPS://AGSIST.COM/R?ID' or null. */
  function checkoutRef(code, gift, shortLink) {
    code = String(code || '');
    if (code && code.length <= 200) return code;
    var m = /\/R\?([0-9A-HJKMNP-TV-Z]{5,8})$/.exec(String(shortLink || ''));
    return m ? (gift ? GIFT_PREFIX : '') + 'RPS-' + m[1] : '';
  }

  /* THE ORDER RECORD (2026-10-20, Sig: a $19 payment showed in Stripe with no
     design on it; client_reference_id sits on the Checkout Session, not on
     the payment page). Every press of Pay that opens Stripe posts this to the
     subs worker first (POST /rp-order, kept 120 days, Sig only reads it at
     /rp-order/list): the same ref Stripe gets, the product, the price shown,
     the full design link and the design in words, so Sig can match a payment
     to a design by ref, or by time and product. Never the buyer's email,
     name or address: Stripe has those. */
  function orderRecord(x, ref, choice, price) {
    var s = normalize(x);
    return {
      ref: String(ref || ''), product: String(choice || ''), price: typeof price === 'number' && isFinite(price) ? price : null,
      design_url: designUrl(x), place: s.place, year: s.year, style: s.style, name: s.name,
      markers: s.markers.map(function (m) { return shortDate(m.date) + (m.label ? ' ' + m.label : ''); }).join('; '),
      dedication: s.dedication, gift: !!s.gift
    };
  }

  /* Labels in a link that were longer than a date's 13 letters: normalize cuts
     them to fit, so the page says so instead of printing "Our wedding d"
     quietly (2026-10-14). [{date, label: as it is now, full: as the link had it}]. */
  function cutLabels(search) {
    var q = new URLSearchParams(String(search || '').replace(/^\?/, '')), raw = [], out = [];
    var d = q.get('d');
    if (d) {
      var s = decodeCode(d), f;
      if (!s) return out;
      try { f = b64urlUtf8(d.replace(/^GIFT-/, '')).split('|'); } catch (e) { return out; }
      if (f[0] === '2' && (f.length - 6) % 2) f.pop();
      for (var i = 6; i + 1 < f.length; i += 2) raw.push({ date: isoFromDay(s.year, parseInt(f[i], 36)), label: f[i + 1] });
    } else {
      for (var j = 1; j <= LIMITS.markers; j++) { var v = q.get('m' + j); if (v) raw.push({ date: v.slice(0, 10), label: v.slice(10) }); }
    }
    raw.forEach(function (m) {
      var full = cleanText(printable(m.label), 200), kept = cleanText(printable(m.label), LIMITS.label);
      if (full.length > kept.length) out.push({ date: m.date, label: kept, full: full });
    });
    return out;
  }

  /* A Stripe reference for a long design is RPS-<id>, or GIFT-RPS-<id> (checkoutRef
     above): the short-link id. rain-print?d=RPS-<id> opens it through the short
     link the way /r?<id> does, and GIFT- keeps the January gift flag (2026-10-14:
     it said the code was damaged). Read the way r.html reads an id: any case, I
     and L as 1, O as 0. {id, gift}, or null when it isn't one. */
  function shortRefOf(code) {
    var m = /^(GIFT-)?RPS-([0-9A-Za-z]{5,8})$/i.exec(String(code || '').trim());
    if (!m) return null;
    var id = m[2].toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
    return /^[0-9A-HJKMNP-TV-Z]{5,8}$/.test(id) ? { id: id, gift: !!m[1] } : null;
  }

  /* Why a share link can't be drawn, in words, or '' when it can (or there is no design in it). */
  function linkProblem(search, todayIso) {
    var q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    var shown = parseInt(String(todayIso || chicagoToday()).slice(0, 4), 10) - 1;
    if (q.get('d')) return decodeCode(q.get('d')) || shortRefOf(q.get('d')) ? '' : 'That link\u2019s design code is damaged or cut short, so it can\u2019t be drawn. Ask whoever sent it for the link again, or type the town and press Draw it.';
    if (q.has('year') && normalize({ year: q.get('year') }).year === null) return 'That link\u2019s year (' + cleanText(q.get('year'), 12) + ') isn\u2019t one I can draw, so this shows ' + shown + '. Pick another year and press Draw it.';
    if (q.has('year') && !cleanText(q.get('place'), LIMITS.place)) return 'That link has no town in it. Type the town and press Draw it.';
    return '';
  }

  // ---------- stations in plain words (pure) ----------
  /* "471667 2" is ACIS's id plus its network (2 = NOAA co-op); the page shows
     "NOAA co-op station 471667", never the raw pair. Names come in caps:
     "CAMERON 2 NE" reads "Cameron, 2 mi NE", "RICE LAKE MUNI AP" reads
     "Rice Lake Municipal Airport". */
  function sidPlain(sid, lang) {
    if (root.AgRpCanada && root.AgRpCanada.isSid(sid)) return root.AgRpCanada.sidPlain(sid, lang);
    var p = String(sid || '').trim().split(/\s+/);
    if (/^US1/.test(p[0])) return 'volunteer gauge ' + p[0];
    return (p[1] === '2' ? 'NOAA co-op station ' : 'NOAA station ') + p[0];
  }
  var STN_WORD = { AP: 'Airport', MUNI: 'Municipal', INTL: 'International', RGNL: 'Regional', CO: 'County', FLD: 'Field', ARPT: 'Airport', STN: 'Station', EXP: 'Experiment', AG: 'Ag' };
  /* {name, off}: "CAMERON 2 NE" is {name: "Cameron", off: "2 mi NE"}. */
  function stationParts(raw) {
    var s = String(raw || '').trim().replace(/\s+/g, ' ');
    // a name already in mixed case (a Canadian station, named by components/rp-canada.js) stays as it is
    if (/[a-z]/.test(s)) return { name: s, off: '' };
    var m = /^(.*?) (\d+(?:\.\d+)?) ?([NSEW]{1,3})$/.exec(s), off = '';
    if (m) { s = m[1]; off = m[2] + ' mi ' + m[3]; }
    return { name: s.split(' ').map(function (w) {
      var u = w.toUpperCase();
      if (STN_WORD[u]) return STN_WORD[u];
      if (/^[NSEW]{1,3}$/.test(u) || /\d/.test(w)) return u;
      return u.charAt(0) + u.slice(1).toLowerCase();
    }).join(' '), off: off };
  }
  function stationName(raw) { var P = stationParts(raw); return P.name + (P.off ? ', ' + P.off : ''); }
  /* The station in one set of words, on the print, the page and the order:
     "Cameron, WI (2 mi NE of Cameron)". m: {name, state or stateAbbr}. */
  function stationLabel(m) {
    var P = stationParts(m && m.name), st = (m && (m.state || m.stateAbbr)) || '';
    /* The station named for the buyer's own town: one distance only, the one
       from the town (2026-10-15: "Ames, IA (2.6 mi NNW of Ames), 2.0 mi from
       Ames" read as two answers). m.city: the buyer's town, when known. */
    var same = m && m.city && P.name.toLowerCase() === String(m.city).trim().toLowerCase();
    return P.name + (st ? ', ' + st : '') + (P.off && !same ? ' (' + P.off + ' of ' + P.name + ')' : '');
  }
  /* The station in the status line (2026-10-17, panels): its own name in
     quotes, so the "2.6 NNW" in "AMES 2.6 NNW" reads as a name and never as a
     second distance, then the one distance the print gives: 'the volunteer
     gauge "AMES 2.6 NNW", 2.0 mi from Ames'. While a draw is on its way (no
     town distance yet), the name alone. */
  function stationSaid(m, dist) {
    if (!m) return '';
    if (m.ca) return stationName(m.name);
    var p = String(m.sid || '').trim().split(/\s+/), raw = String(m.name || '').trim().replace(/\s+/g, ' ');
    var kind = /^US1/.test(p[0]) ? 'the volunteer gauge ' : p[1] === '2' ? 'the co-op station ' : 'the weather station ';
    return kind + '\u201c' + raw + '\u201d' + (dist && m.city ? ', ' + distText(m) : '');
  }
  function milesText(mi) { return mi < 0.1 ? 'under 0.1 mi' : (mi < 10 ? mi.toFixed(1) : String(Math.round(mi))) + ' mi'; }

  /* A PNG's bytes with pHYs (pixels per inch, so it opens at its print size,
     not 72 dpi) and sRGB chunks put in right after IHDR. Pure: the tests run it.
     Returns the bytes unchanged when they are not a PNG or already say so. */
  var CRC_T = null;
  function crc32(b, from, to) {
    if (!CRC_T) { CRC_T = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var x = 0xFFFFFFFF;
    for (var i = from; i < to; i++) x = CRC_T[(x ^ b[i]) & 0xFF] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  function pngChunk(type, data) {
    var out = new Uint8Array(12 + data.length), i;
    var u32 = function (at, v) { out[at] = v >>> 24 & 255; out[at + 1] = v >>> 16 & 255; out[at + 2] = v >>> 8 & 255; out[at + 3] = v & 255; };
    u32(0, data.length);
    for (i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    u32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  }
  function pngWithDpi(bytes, dpi) {
    var b = bytes, sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!b || b.length < 33 || sig.some(function (v, i) { return b[i] !== v; })) return b;
    if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return b;
    var end = 8 + 12 + ((b[8] << 24 | b[9] << 16 | b[10] << 8 | b[11]) >>> 0);   // after IHDR
    var t = String.fromCharCode(b[end + 4], b[end + 5], b[end + 6], b[end + 7]);
    if (t === 'pHYs' || t === 'sRGB') return b;
    var ppm = Math.round(dpi / 0.0254);
    var phys = new Uint8Array([ppm >>> 24 & 255, ppm >>> 16 & 255, ppm >>> 8 & 255, ppm & 255, ppm >>> 24 & 255, ppm >>> 16 & 255, ppm >>> 8 & 255, ppm & 255, 1]);
    var a = pngChunk('pHYs', phys), c = pngChunk('sRGB', new Uint8Array([0]));
    var out = new Uint8Array(b.length + a.length + c.length);
    out.set(b.subarray(0, end), 0); out.set(a, end); out.set(c, end + a.length); out.set(b.subarray(end), end + a.length + c.length);
    return out;
  }

  /* ------------------------------------------------ the data (page and gift card)
     The NOAA and town calls, shared by the page below and the gift card's
     preview (previewArt, rp-gift.html). Moved up here 2026-10-14 so the card
     reads the same records the same way; nothing in them changed. */
  var MISS_BLOCK = 31;   // more than a month unrecorded: no print, the page says why
  var TODAY = chicagoToday();                     // YYYY-MM-DD in Chetek's time zone
  var CURRENT_YEAR = parseInt(TODAY.slice(0, 4), 10);
  var GIFT_MIN_DAYS = 60;  // a gift preview needs the year recorded at least this far (to about March 1); less is too thin to draw fairly
  var STALE_DAYS = 30;     // this year: a station whose record stopped longer ago than this is not reporting, so it cannot make the print
  var EXT_CACHE = new Map(), NORM_CACHE = new Map(), DAILY_CACHE = new Map();
  var LOAD_FAIL = new Set();   // the asks that failed or timed out (loadFail, below)
  /* LAST YEAR IN JANUARY (2026-10-14, panel 3). NOAA's daily numbers come in
     late, by days and at some co-op stations by weeks, so on Jan 1 last year
     isn't all in yet. While it is "open", last year is read like this year:
     a station still behind on December stays in the list, the days it hasn't
     sent from the last STALE_DAYS are left off instead of counted as gaps,
     the print is drawn as the year so far, and the order says it is made once
     the full year is in. Open means today is within STALE_DAYS of Dec 31 (a
     station later than that is not reporting, the same rule as this year's),
     or before full_year_from (MM-DD) in data/rain-print.json. A year whose
     December is all in counts as finished from full_year_from on; "01-01",
     the default, means as soon as it is in. */
  var FULL_YEAR_FROM = '01-01';
  function lastYearOpen(year) {
    return year === CURRENT_YEAR - 1 && (TODAY < CURRENT_YEAR + '-' + FULL_YEAR_FROM || TODAY <= isoMinusDays(year + '-12-31', -STALE_DAYS));
  }
  function settlingByDate(year) { return year === CURRENT_YEAR - 1 && TODAY < CURRENT_YEAR + '-' + FULL_YEAR_FROM; }

  // ---------- data ----------
  function miles(km) { return km * 0.621371; }

  /* Every outside call gives up after FETCH_MS (2026-10-13: a slow NOAA left
     "Looking for NOAA stations" up for good with Draw turned off). The error
     says who was slow; the status line then offers a Try again button. */
  var FETCH_MS = 15000;
  /* The asks still out for the draw on its way. A new draw stops them (the
     town lookup, the station list, a year's days); the station's full record
     (sdate=por), the big one, is left to finish, since a redraw of the same
     station uses it (2026-10-15). */
  var LIVE = [];
  function abortLive() {
    var keep = [];
    LIVE.forEach(function (x) { if (/sdate=por/.test(x.url)) keep.push(x); else { x.stopped = true; try { x.ctl.abort(); } catch (e) {} } });
    LIVE = keep;
  }
  // opts (2026-10-16): a HEAD or a byte range, for the Canadian station files (components/rp-canada.js)
  function safeFetch(url, opts) {
    var who = /open-meteo/.test(url) ? 'The town lookup' : 'NOAA\u2019s data service';
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, timedOut = false;
    var live = ctl ? { ctl: ctl, url: url, stopped: false } : null;
    if (live) LIVE.push(live);
    var gone = function () { if (live) LIVE = LIVE.filter(function (x) { return x !== live; }); };
    var timer = setTimeout(function () { timedOut = true; if (ctl) ctl.abort(); }, FETCH_MS);
    var slow = function () { var e = new Error(who + ' is slow right now and didn\u2019t answer in ' + (FETCH_MS / 1000) + ' seconds. Try again in a minute.'); e.retry = true; return e; };
    var race = new Promise(function (res, rej) { setTimeout(function () { if (!ctl) rej(slow()); }, FETCH_MS + 50); });
    var f = fetch(url, ctl || opts ? Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {}) : undefined).then(function (r) {
      clearTimeout(timer); gone();
      if (!r.ok) { var e = new Error(who + ' didn\u2019t answer (error ' + r.status + '). Try again in a minute.'); e.retry = true; e.status = r.status; throw e; }
      // an answer that isn't data (a proxy's or an outage page) says so in words, not as a script error (panel 3 F7)
      var json = r.json.bind(r);
      r.json = function () { return json().catch(function () { var e2 = new Error(who + ' sent back something that isn\u2019t data. Try again in a minute.'); e2.retry = true; throw e2; }); };
      return r;
    }, function () {
      clearTimeout(timer); gone();
      if (live && live.stopped) throw 'stale';
      if (timedOut) throw slow();
      var e = new Error(who + ' couldn\u2019t be reached. Check the connection and try again.'); e.retry = true; throw e;
    });
    return Promise.race([f, race]);
  }
  // the town lookup; the page keeps the reader's own pick from a "which one?" list (PICKED) in front of it
  var GEO_CACHE = new Map();   // query -> the town found (a redraw doesn't ask again)
  var GEO_LANG = 'en';         // the language a Canadian town lookup answers its errors in (the page sets it)
  function geoFind(q) {
    var key = String(q).trim().toLowerCase();
    if (GEO_CACHE.has(key)) return Promise.resolve(GEO_CACHE.get(key));
    return geoAsk(q).then(function (hit) { GEO_CACHE.set(key, hit); return hit; });
  }
  /* CANADA (2026-10-16). A town with a province ("Regina, SK"), a postal code or a
     Canadian station id goes to components/rp-canada.js, which answers in the same
     shapes as Open-Meteo and RCC-ACIS do for a US town; everything after that is
     this file's own rules. Without that file loaded, nothing changes. */
  function CA() { return root.AgRpCanada || null; }
  function isCanada(placeOrSid) { var c = CA(); return !!c && (c.isSid(placeOrSid) || c.isCanadian(placeOrSid)); }
  function caEnv(year) { return { currentYear: CURRENT_YEAR, today: TODAY, stale: STALE_DAYS, open: year ? lastYearOpen(year) : false }; }
  function geoAsk(q) {
    if (CA() && CA().isCanadian(q)) return CA().geoAsk(q, safeFetch, GEO_LANG);
    var g = geocodeQuery(q);
    var u = 'https://geocoding-api.open-meteo.com/v1/search?count=10&countryCode=US&name=' + encodeURIComponent(g.town);
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
      var r = geoPick(q, j && j.results);
      if (r.error) throw new Error(r.error);
      if (r.pick) { var e = new Error('pick'); e.pick = r.pick; throw e; }
      return r.hit;
    });
  }
  function isoMinusDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10); }
  function lastDayOf(year) { return year === CURRENT_YEAR ? TODAY : year + '-12-31'; }
  /* THE STATION LIST (2026-10-15: snowfall too). Two StnMeta asks over the
     same box: precipitation (the list, as before) and snowfall, so each
     station knows before any drawing whether its snowfall record spans the
     year (snowOk). Two asks, not one with elems=pcpn,snow, because ACIS
     doesn't say whether a two-element ask drops stations that keep only one
     of them; a rain-only gauge must stay in the list. A snowfall answer that
     fails leaves snowOk null (not known), never false. */
  function spans(r, y0, y1) { return !!(r && r[0] && r[1] && r[0] <= y0 && r[1] >= y1); }
  var STN_CACHE = new Map();   // lat|lon|year -> the station list
  // ca: the town is in Canada (its geocode said so): the Canadian station list instead of ACIS
  var NEXT_CA = false;   // the page's next station list is Canadian (run() sets it from the town found)
  function stations(lat, lon, year, ca) {
    if (ca === undefined) { ca = NEXT_CA; NEXT_CA = false; }
    var key = (+lat).toFixed(3) + '|' + (+lon).toFixed(3) + '|' + year + (ca ? '|ca' : '');
    if (STN_CACHE.has(key)) return Promise.resolve(STN_CACHE.get(key));
    var ask = ca && CA() ? CA().stations(safeFetch, lat, lon, year, caEnv(year)) : stationsAsk(lat, lon, year);
    return ask.then(function (list) { STN_CACHE.set(key, list); return list; });
  }
  function stationsAsk(lat, lon, year) {
    var d = 0.6;
    var box = [lon - d, lat - d, lon + d, lat + d].map(function (x) { return x.toFixed(3); }).join(',');
    var u = 'https://data.rcc-acis.org/StnMeta?' + new URLSearchParams({
      bbox: box,
      elems: 'pcpn', sdate: year + '-01-01', edate: lastDayOf(year), meta: 'name,sids,ll,valid_daterange,state,elev'
    });
    var us = 'https://data.rcc-acis.org/StnMeta?' + new URLSearchParams({ bbox: box, elems: 'snow', sdate: year + '-01-01', edate: lastDayOf(year), meta: 'sids,valid_daterange' });
    // This year: the record must reach back to Jan 1 and still be current. Last
    // year while it is open (lastYearOpen): current, up to Dec 31.
    var late = isoMinusDays(TODAY, STALE_DAYS);
    var y0 = year + '-01-01', y1 = year === CURRENT_YEAR ? late : lastYearOpen(year) && late < year + '-12-31' ? late : year + '-12-31';
    var snowP = safeFetch(us).then(function (r) { return r.json(); }).then(function (j) {
      var by = {};
      (j && j.meta || []).forEach(function (m) { if (m.sids && m.sids[0]) by[cleanSid(m.sids[0])] = m.valid_daterange && m.valid_daterange[0]; });
      return by;
    }).then(null, function () { return null; });
    return Promise.all([safeFetch(u).then(function (r) { return r.json(); }), snowP]).then(function (res) {
      var j = res[0], snow = res[1];
      return (j.meta || []).filter(function (m) { return m.ll && m.sids && m.sids[0] && m.valid_daterange && m.valid_daterange[0] && m.valid_daterange[0][0] <= y0 && m.valid_daterange[0][1] >= y1; })
        .map(function (m) {
          var sid = cleanSid(m.sids[0]);
          return Object.assign({}, m, { sid: sid, km: haversine(lat, lon, m.ll[1], m.ll[0]), snowOk: snow ? spans(snow[sid], y0, y1) : null });
        })
        .sort(function (a, b) { return a.km - b.km; });
    });
  }

  /* THE AUTO PICK (2026-10-15, Sig: "find the nearest station with a full set
     of data, in my case that includes snow and rain"). Chetek 2025 took a
     CoCoRaHS gauge 1.9 mi away that keeps no snowfall, so the print drew no
     snow, while Rice Lake's co-op station 9 mi away keeps both.
       1. Rain, as before: the first of the nearest three with at most MISS_OK
          unrecorded days, else the most complete of them.
       2. Snow: where snow is normal (snowCountry), when that station's year
          draws no snow (snowStateOf is 'unknown', the art's own test), the
          nearest station whose snowfall record spans the year (snowOk from
          StnMeta) and lies within max(10 mi farther, twice as far) is read
          (up to SNOW_TRIES of them, nearest first). The first with a usable
          rain year AND a usable snowfall year (by its real days, not the
          metadata) is taken; else the rain pick stays and the page says so.
     Only for a design with no station of its own: a short link, an RPS
     reference, a gift card or any saved design keeps its station exactly.
       pickStation(list, year, read(sid, year) -> Promise of daily(), o)
         o: {lat (the town's), snowy (overrides snowCountry), onTry(station, 'rain'|'snow')}
         -> Promise of {chosen, picked, why, seen}
       why: null, {over: {sid, name, km}} (picked over that nearer one) or
         {none: true, km, sure} (no snow station within km; sure: every
         station there was read or ruled out, none failed to answer); seen: {sid: snow state}. */
  var SNOW_SLACK_MI = 10, SNOW_TRIES = 3;
  function snowStateOf(days) {
    days = days || [];
    if (!days.length) return 'unknown';
    var c = snowCount(days), miss = c.miss, tot = c.tot;
    return miss <= MISS_OK ? (tot >= 0.1 ? 'full' : 'none') : 'unknown';
  }
  /* Where snow is not normal (a normal under about 2 in a year), a station
     farther off is never taken for its snowfall record. A plain map test,
     not a normals lookup: island states and territories, Florida, anywhere
     south of 31 N (south Texas, the Gulf coast), the low Gulf and South
     Atlantic coast up to 33 N, low Texas and New Mexico south of 33 N, and
     the low deserts and valleys of California, Arizona and Nevada (under
     3,000 ft; a station of unknown height there counts as low). Mountains
     there (Flagstaff, Reno, the Sierra) keep snow. elev: feet, as ACIS sends it. */
  function snowCountry(o) {
    var st = String(o && o.state || '').toUpperCase(), lat = +(o && o.lat), elev = o && typeof o.elev === 'number' ? o.elev : null;
    if (/^(HI|PR|VI|GU|AS|MP|FL)$/.test(st)) return false;
    if (!isFinite(lat)) return true;
    if (lat < 31) return false;
    var low = function (ft) { return elev === null || elev < ft; };
    if (/^(LA|MS|AL|GA|SC)$/.test(st) && lat < 33 && low(500)) return false;
    if (/^(TX|NM)$/.test(st) && lat < 33 && low(3000)) return false;
    if (/^(CA|AZ|NV)$/.test(st) && low(3000)) return false;
    return true;
  }
  function snowLimitKm(km) { return Math.max(km + SNOW_SLACK_MI / 0.621371, 2 * km); }
  function pickStation(list, year, read, o) {
    o = o || {};
    var pool = (list || []).slice(), seen = {}, tried = {};
    var tries = pool.slice(0, 3), best = null, bestSt = null, chosen = null, picked = null, i = 0, got = {};
    /* The candidates are read at once, in parallel (2026-10-15: one after
       another cost a phone several seconds), and their answers are judged
       nearest first by the same rules as before: the result is the same. */
    var readAll = function (list, kind) {
      if (list.length && o.onTry) o.onTry(list[0], kind);
      return Promise.all(list.map(function (s) {
        // a station already read for its rain is not asked again for its snow
        if (got[s.sid]) return got[s.sid];
        return (got[s.sid] = read(s.sid, year).then(function (d) { return { d: d }; }, function () { return { fail: true }; }));
      }));
    };
    var rainStep = function () {
      return readAll(tries, 'rain').then(function (ans) {
        for (i = 0; i < tries.length; i++) {
          var s = tries[i], a = ans[i];
          if (a.fail) { tried[s.sid] = Infinity; continue; }
          var d = a.d;
          tried[s.sid] = d.d.missing; seen[s.sid] = snowStateOf(d.days);
          if (!best || d.d.missing < best.d.missing) { best = d; bestSt = s; }
          if (d.d.missing <= MISS_OK) { picked = d; chosen = s; return null; }
        }
        picked = best; chosen = bestSt;
        return null;
      });
    };
    var done = function (why) { return { chosen: chosen, picked: picked, why: why || null, seen: seen }; };
    return Promise.resolve(rainStep()).then(function () {
      if (!picked) return done(null);
      var snowy = o.snowy !== undefined ? !!o.snowy : snowCountry({ lat: o.lat !== undefined ? o.lat : chosen.ll && chosen.ll[1], state: chosen.state, elev: chosen.elev });
      if (!snowy || seen[chosen.sid] !== 'unknown') return done(null);
      var limit = snowLimitKm(chosen.km), first = chosen, j = 0;
      var all = pool.filter(function (s) {
        return s.sid !== first.sid && s.snowOk !== false && s.km <= limit && !(tried[s.sid] > MISS_OK) && seen[s.sid] !== 'unknown';
      }), cands = all.slice(0, SNOW_TRIES), sure = all.length <= SNOW_TRIES;
      return readAll(cands, 'snow').then(function (ans) {
        for (j = 0; j < cands.length; j++) {
          var s = cands[j], a = ans[j];
          if (a.fail) { sure = false; continue; }
          var st = seen[s.sid] = snowStateOf(a.d.days);
          if (a.d.d.missing > MISS_OK || st === 'unknown') continue;
          chosen = s; picked = a.d;
          return done({ over: { sid: first.sid, name: first.name, km: first.km } });
        }
        return done({ none: true, km: limit, sure: sure });
      });
    });
  }
  /* The sentence by the station line that says why this station: "Picked over
     a gauge 1.9 mi away because it records snowfall too." */
  function pickWhy(why, year) {
    if (!why) return '';
    if (why.over) return 'Picked over a ' + (/^US1/.test(String(why.over.sid)) ? 'gauge' : 'station') + ' ' + milesText(miles(why.over.km)) + ' away because it records snowfall too.';
    if (why.none) return why.sure ? 'None of the stations within ' + Math.round(miles(why.km)) + ' mi kept a full snowfall record for ' + year + ', so the print draws no snow.'
      : 'The nearest stations that keep snowfall didn\u2019t send a full ' + year + ' of it, so the print draws no snow.';
    return '';
  }
  // the station list's word for each: by its real days once read, else by NOAA's list
  function snowWord(s, seen) {
    var st = seen && seen[s.sid];
    if (st) return st === 'unknown' ? 'rain only' : 'rain and snow';
    return s.snowOk === true ? 'rain and snow' : s.snowOk === false ? 'rain only' : '';
  }
  function parseTemp(raw) { var s = String(raw).trim(); if (s === 'M' || s === '') return null; var v = parseFloat(s); return isNaN(v) ? null : v; }
  // pcpn, avgt (daily mean temperature, F), snow, maxt and mint come back as parallel columns from one
  // call; the raw rows are kept for the remarkable-days layer (components/rain-print-records.js)
  function daily(sid, year) {
    var open = lastYearOpen(year), key = sid + '|' + year + (open ? '|open' : '');
    if (DAILY_CACHE.has(key)) return Promise.resolve(DAILY_CACHE.get(key));
    var u = 'https://data.rcc-acis.org/StnData?' + new URLSearchParams({ sid: sid, sdate: year + '-01-01', edate: lastDayOf(year), elems: 'pcpn,avgt,snow,maxt,mint', meta: 'name,state,ll' });
    var ask = CA() && CA().isSid(sid) ? CA().yearJson(safeFetch, sid, year, caEnv(year)) : safeFetch(u).then(function (r) { return r.json(); });
    return ask.then(function (j) {
      if (j.error || !Array.isArray(j.data)) throw new Error('That station has no rain record for this year. Pick another one under Weather station.');
      var days = [];
      j.data.forEach(function (row) {
        // snow: NOAA's separate snowfall record (inches of snow as it fell). pcpn already
        // counts that snow melted down to water, so snowfall is shown beside it, never added.
        var p = parsePcpn(row[1]), t = row[2] !== undefined ? parseTemp(row[2]) : null, sn = row[3] !== undefined ? parsePcpn(row[3]).v : null;
        var dt = new Date(row[0] + 'T00:00:00'), dy = { date: row[0], v: p.v, flag: p.flag, t: t, s: sn, m: dt.getMonth(), d: dt.getDate(), doy: days.length };
        // a snowfall "T" (2026-10-20, Sig: "a trace should somehow show as a trace"): snow fell, under 0.1 in (not in summer: snowTraceRaw).
        // It stays 0 in every snow total; sT only lets the print mark the day. Not the gauge's own T (flag).
        if (snowTraceRaw(row[3], row[0])) dy.sT = true;
        days.push(dy);
      });
      // This year: stop at the last recorded day. The days after it have not
      // come in yet (NOAA's daily numbers lag a few days); they are not gaps.
      if (year === CURRENT_YEAR) days = days.slice(0, lastRecorded(days) + 1);
      // Last year while it is open: the same, for the days of the last STALE_DAYS
      // only. A day older than that with no report is a gap, as in any year.
      else if (open) {
        var lateFrom = isoMinusDays(TODAY, STALE_DAYS), sure = days.filter(function (x) { return x.date <= lateFrom; }).length;
        days = days.slice(0, Math.max(sure, lastRecorded(days) + 1));
      }
      days = closeOpenS(days);
      var out = { meta: j.meta || {}, days: days, d: derive(days), raw: j.data };
      DAILY_CACHE.set(key, out);
      return out;
    });
  }
  // Full period-of-record daily totals: the station's own daily average (the
  // "station" comparison) and the rows the remarkable-days layer ranks against.
  function stationExtremes(sid) {
    if (EXT_CACHE.has(sid)) return Promise.resolve(EXT_CACHE.get(sid));
    var u = 'https://data.rcc-acis.org/StnData?' + new URLSearchParams({ sid: sid, sdate: 'por', edate: 'por', elems: 'pcpn,avgt' });
    var ask = CA() && CA().isSid(sid) ? CA().porJson(safeFetch, sid) : safeFetch(u).then(function (r) { return r.json(); });
    return ask.then(function (j) {
      if (j.error || !Array.isArray(j.data)) throw new Error(j.error || 'no data');
      var maxDaily = 0, curYear = null, curYearTotal = 0, curMonth = null, curMonthTotal = 0, maxAnnual = 0, maxMonthly = 0;
      var yearFrom = null, yearTo = null, maxTemp = null, minTemp = null, sum = new Map(), count = new Map();
      j.data.forEach(function (row) {
        var v = parsePcpn(row[1]).v, t = row[2] !== undefined ? parseTemp(row[2]) : null;
        var date = row[0], year = date.slice(0, 4), month = date.slice(0, 7), md = date.slice(5);
        if (yearFrom === null) yearFrom = year; yearTo = year;
        if (t !== null) { if (maxTemp === null || t > maxTemp) maxTemp = t; if (minTemp === null || t < minTemp) minTemp = t; }
        if (v === null) return;
        if (v > maxDaily) maxDaily = v;
        if (year !== curYear) { if (curYear !== null) maxAnnual = Math.max(maxAnnual, curYearTotal); curYear = year; curYearTotal = 0; }
        curYearTotal += v;
        if (month !== curMonth) { if (curMonth !== null) maxMonthly = Math.max(maxMonthly, curMonthTotal); curMonth = month; curMonthTotal = 0; }
        curMonthTotal += v;
        sum.set(md, (sum.get(md) || 0) + v);
        count.set(md, (count.get(md) || 0) + 1);
      });
      if (curYear !== null) maxAnnual = Math.max(maxAnnual, curYearTotal);
      if (curMonth !== null) maxMonthly = Math.max(maxMonthly, curMonthTotal);
      var avgByDate = new Map();
      sum.forEach(function (s, md) { avgByDate.set(md, s / count.get(md)); });
      var years = yearFrom && yearTo ? (parseInt(yearTo, 10) - parseInt(yearFrom, 10) + 1) : 0;
      var ext = { maxDaily: maxDaily, maxMonthly: maxMonthly, maxAnnual: maxAnnual, avgByDate: avgByDate, yearFrom: yearFrom, yearTo: yearTo, years: years, maxTemp: maxTemp, minTemp: minTemp, rows: j.data };
      EXT_CACHE.set(sid, ext);
      LOAD_FAIL.delete('por|' + sid);
      return ext;
    }).then(null, function (err) { if (err && err.retry) LOAD_FAIL.add('por|' + sid); throw err; });
  }
  // NOAA's 30-year normal for each date, from ACIS's own normal element (period
  // not verified live, so never printed). A station without a normals product
  // fails here and the comparison says so.
  /* ACIS's "91" is the 1991-2020 normals, the set the county rain pages use
     (scripts/fetch_county_rain.py); the older code 1 is asked only when "91"
     has nothing for the station (2026-10-14, panel 3 D4). */
  function stationNormal(sid, year) {
    var key = sid + '|' + year;
    if (NORM_CACHE.has(key)) return Promise.resolve(NORM_CACHE.get(key));
    var ask = function (code) {
      var params = JSON.stringify({ sid: sid, sdate: year + '-01-01', edate: year + '-12-31', elems: [{ name: 'pcpn', normal: code }] });
      return safeFetch('https://data.rcc-acis.org/StnData?params=' + encodeURIComponent(params)).then(function (r) { return r.json(); });
    };
    var first = CA() && CA().isSid(sid) ? CA().normalJson(safeFetch, sid, year) : ask('91').then(function (j) { return j && !j.error && Array.isArray(j.data) ? j : ask(1); });
    return first.then(function (j) {
      if (j.error || !Array.isArray(j.data)) throw new Error(j.error || 'no data');
      var byDate = new Map();
      j.data.forEach(function (row) { var v = parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
      NORM_CACHE.set(key, byDate);
      LOAD_FAIL.delete('norm|' + key);
      return byDate;
    }).then(null, function (err) { if (err && err.retry) LOAD_FAIL.add('norm|' + key); throw err; });
  }

  // the place on the print, the state written out: "Chetek, Wisconsin"
  function placeLongOf(m) {
    var full = STATE[String(m.stateAbbr || '').toLowerCase()];
    return m.city + ', ' + (full ? toTitle(full) : (m.stateAbbr || m.state || ''));
  }
  // the dates that fall on the days drawn (n of them), as the art takes them
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function markersOn(markers, year, n) {
    return (markers || []).map(function (m) {
      var doy = dayIndex(year, m.date);
      var p = m.date.split('-').map(Number);
      return doy >= 0 && doy < n ? { doy: doy, label: m.label || MON3[p[1] - 1] + ' ' + p[2] } : null;
    }).filter(Boolean);
  }
  function cmpNoteFor(cmp, ext) {
    if (cmp === 'normal') return 'A usual year: NOAA’s 30-year normal';
    if (cmp === 'station' && ext) return 'A usual year: this station’s average, ' + ext.yearFrom + ' to ' + ext.yearTo;
    return '';
  }
  /* ---------- the 2026-10-17 options, as the art takes them (pure: the tests run these) ----------
     Temperatures come from the nearest station with daily highs and lows for the year (the print's own
     gauge when it keeps them: tempStationOk); the crop's usual year from NOAA's 1991-2020 normals at that
     station; the history from the station's own full years (components/rain-print-extras.js says what
     counts as full). Nothing is drawn that the data doesn't hold. */
  var TEMP_GAP_OK = 10, HIST_MIN = 30;
  var TEMP_KINDS = ['coldest', 'hottest', 'lastFrost', 'firstFrost'];
  function X_() { return root.AgRainExtras || null; }
  // a station's year is good for temperatures with at most TEMP_GAP_OK days missing a high or a low (through the last day in)
  function tempStationOk(td, lastDoy) { var X = X_(); return !!(X && td) && X.tempGaps(td, 0, lastDoy === undefined ? td.n - 1 : lastDoy) <= TEMP_GAP_OK; }
  // the foot line's words for where the temperatures came from: tm = {same (the gauge itself), name, words (distance)}
  function tempWords(tm) { return tm.same ? 'Temperatures from the same station' : 'Temperatures: ' + tm.name + (tm.words ? ', ' + tm.words : ''); }
  // "3.1 mi away" from a distance in km (the temperature station's, from the town)
  function tempAway(km) { return milesText(miles(km)) + ' away'; }
  /* s: the design; td: the temperature station's year (AgRainExtras.tempDays); tdN: its 1991-2020 normals
     (or null); -> the art's input.crop, or null (no crop, or nothing to place). */
  function cropInput(s, td, tdN) {
    var X = X_();
    if (!X || !s.crop || !td || !X.CROPS[s.crop]) return null;
    var C = X.CROPS[s.crop], st = X.cropStages(s.crop, td, s.cropPlant, s.cropHarvest);
    if (!st) return null;
    var gh = s.ghost && tdN ? X.cropStages(s.crop, tdN, s.cropPlant, s.cropHarvest) : null, cmp = gh ? X.compare(st, gh, C.key) : null;
    var foot = [C.foot + (st.stop === 'missing' ? '; no stage claimed after ' + shortDate(st.stopDate) + ', a day with no temperature' : '')];
    if (gh) foot.push((s.plants ? 'Gray plants: a usual year' : 'Days ahead or behind: against a usual year') + ' (NOAA 1991 to 2020 normal temperatures)');
    return { kind: s.crop, name: C.name, plant: dayIndex(td.year, s.cropPlant), harvest: dayIndex(td.year, s.cropHarvest), stages: st.stages,
      ghost: gh ? gh.stages.map(function (g) { return { key: g.key, doy: g.doy }; }) : null, note: cmp, drawings: !!s.plants, stop: st.stop, foot: foot };
  }
  /* The frost marks, the hottest and coldest day, the ribbon. found: AgRainRecords.find() on the temperature
     station's year, kinds TEMP_KINDS (it withholds what a missing day could change); tm: tempWords' station.
     -> input.temp, or null when none of the three is on or there's nothing to show. */
  function tempInput(s, td, found, tm, withCrop) {
    var X = X_(), by = {}, out = { frost: [], foot: [], ribbon: null };
    if (!(s.frost || s.heat || s.ribbon || withCrop) || !td || !X) return null;
    (found || []).forEach(function (r) { by[r.kind] = r; });
    if (s.frost) ['lastFrost', 'firstFrost'].forEach(function (k) {
      var r = by[k]; if (!r) return;
      var d = dayIndex(td.year, r.date); if (d >= 0) out.frost.push({ key: k === 'lastFrost' ? 'last' : 'first', doy: d, date: r.date });
    });
    if (s.ribbon) { var sc = X.ribbonScale(td); if (sc) out.ribbon = { hi: td.hi, lo: td.lo, scale: sc }; }
    var heat = [];
    if (s.heat) [['hottest', 'Hottest day'], ['coldest', 'Coldest']].forEach(function (p) {
      var r = by[p[0]]; if (!r) return;
      var tie = /\((also [^)]*|on \d+ days)\)$/.exec(r.label);
      heat.push(p[1] + ': ' + Math.round(r.value) + '°F ' + shortDate(r.date) + (tie ? ' (' + tie[1] + ')' : ''));
    });
    if (!out.frost.length && !heat.length && !out.ribbon && !withCrop) return null;
    out.foot.push(tempWords(tm) + (out.frost.length ? '; frost is a low of 32°F or colder' : ''));
    heat.forEach(function (t) { out.foot.push(t); });
    return out;
  }
  // records the temperature layer shows itself come off the remarkable days, so nothing prints twice
  function withoutTemp(recs, s) { return s.frost || s.heat ? (recs || []).filter(function (r) { return TEMP_KINDS.indexOf(r.kind) < 0; }) : recs || []; }
  /* full: AgRainExtras.fullYears() for the print's station. -> input.hist, or null under HIST_MIN full years. */
  function histInput(full, year) {
    var X = X_();
    if (!X || !full || full.length < HIST_MIN) return null;
    var others = full.filter(function (f) { return f.year !== +year; }), rk = X.rank(full, year);
    return { threads: others.map(function (f) { return { year: f.year, cum: f.cum }; }), labels: X.remarkableYears(full, year), note: rk ? rk.text : '',
      foot: 'Gray lines: the other ' + others.length + ' full years this station kept, ' + full[0].year + ' to ' + full[full.length - 1].year + ' (the nearest station with ' + HIST_MIN + ' or more)' };
  }
  function gaugeWords(m) { return stationLabel(m); }
  function distText(m) {
    if (m.approx) return 'near ' + m.city;   // a county link whose town the lookup didn't know: no distance claimed
    return milesText(miles(m.km)) + ' from ' + m.city;
  }
  // the station line on the art itself: name and distance, both styles
  function gaugeLine(m) {
    // a Canadian station: km, its province, its own words (m.lang: the print's language, set by the page)
    if (m && m.ca && root.AgRpCanada) return root.AgRpCanada.gaugeLine(m, m.lang || 'en');
    return 'Weather station: ' + gaugeWords(m) + ', ' + distText(m);
  }
  function longDate(iso) { var p = String(iso).split('-').map(Number); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p[1] - 1] + ' ' + p[2]; }

  /* THE GIFT CARD'S PREVIEW (2026-10-14, Sig). rp-gift.html shows the print so
     far on the card Sig emails for a this-year gift. previewArt(code) opens the
     card's design code the way the page opens ?d=, reads the same town, station
     record and comparison, and draws with the same art (AgRainArt.render, with
     the page's preview of this year: Jan 1 through the last reported day on the
     whole calendar, the PREVIEW band across it). No second drawing.
       previewArt(code, {idPrefix, later}) -> Promise of {svg, last (ISO), year, place,
         station, days (recorded so far), preview (true for this year)}
     It rejects with an Error saying why in plain words when there is nothing
     fair to draw: the design doesn't open, NOAA didn't answer, the station has
     more than a month missing, or under GIFT_MIN_DAYS days are in (the page
     draws no art then either). The station in the design is used; a design
     without one takes the page's own pick (pickStation: the nearest good rain
     record, traded for a snowfall record within the slack where snow is normal). Remarkable days are left off, as on the page's preview. The QR
     is the standard code to the Rain Print page (a preview, never the print's
     own link), and no short link is asked for.
     later: words for the months still to come, drawn in a pale wash over them
     (the art's preview.later; the page never sets it). */
  function previewArt(code, opts) {
    opts = opts || {};
    var s = decodeCode(code);
    if (!s) return Promise.reject(new Error('The design code on this card doesn’t open.'));
    if (!root.AgRainArt) return Promise.reject(new Error('The drawing script didn’t load.'));
    var mode = yearMode(s.year, TODAY), g = null, chosen = null, picked = null;
    if (mode === 'future') return Promise.reject(new Error(s.year + ' hasn’t started yet.'));
    return geoFind(s.place).then(null, function () { return null; }).then(function (hit) {
      g = hit;
      if (s.station) {
        return daily(s.station, s.year).then(function (d) {
          if (!d || !d.meta || !Array.isArray(d.meta.ll) || d.meta.ll.length < 2) throw new Error('NOAA didn’t send the station’s place.');
          picked = d;
          chosen = { sid: s.station, name: d.meta.name || s.station, state: d.meta.state || '', ll: d.meta.ll };
          // a town of that name far from the station is another town: "near" it, as the page says (run())
          if (g && haversine(g.latitude, g.longitude, +d.meta.ll[1], +d.meta.ll[0]) > 60) g = null;
        });
      }
      if (!g) throw new Error('The town lookup didn’t answer.');
      return stations(g.latitude, g.longitude, s.year, g.country_code === 'CA').then(function (list) {
        if (!list.length) throw new Error('No weather station near ' + g.name + ' is reporting for ' + s.year + '.');
        // the page's own pick, snowfall rule and all (a design with a station never gets here)
        return pickStation(list, s.year, daily, { lat: g.latitude }).then(function (r) { picked = r.picked; chosen = r.chosen; });
      });
    }).then(function () {
      if (!picked) throw new Error('NOAA didn’t send this year’s days.');
      var days = picked.days, preview = mode === 'gift' || (lastYearOpen(s.year) && days.length < (isLeap(s.year) ? 366 : 365));
      if (picked.d.missing > MISS_BLOCK) throw new Error('The station has ' + picked.d.missing + ' unrecorded days so far.');
      if (preview && days.length < GIFT_MIN_DAYS) throw new Error(days.length ? 'Only ' + days.length + ' days of ' + s.year + ' are in so far.' : 'No days of ' + s.year + ' are in yet.');
      var town = g || { name: parts0(s.place), admin1: '', approx: true };
      var caD = !!(CA() && CA().isSid(chosen.sid));
      var stateAbbr = caD ? String((g && g.prov) || picked.meta.state || chosen.state || '').toUpperCase() : abbrFor(String(town.admin1 || '').toLowerCase()) || picked.meta.state || chosen.state || '';
      var km = g ? haversine(g.latitude, g.longitude, chosen.ll[1], chosen.ll[0]) : 0;
      var meta = { approx: !g, name: picked.meta.name || chosen.name, state: picked.meta.state || chosen.state || '', stateAbbr: stateAbbr,
        year: s.year, km: km, city: town.name, sid: chosen.sid };
      // a Canadian design draws in its own units and language, with its own place and station words (the page's rules)
      var loc = caD ? locOf(s, true, stateAbbr.toLowerCase()) : null;
      if (caD) { meta.ca = true; meta.prov = stateAbbr.toLowerCase(); meta.src = picked.meta.src || ''; }
      var cmp = s.cmp === 'normal' ? stationNormal(chosen.sid, s.year) : s.cmp === 'station' ? stationExtremes(chosen.sid) : null;
      // opts.noQr: the gift card has its own QR for the card; a second square for the design only confuses (panel 3 D8)
      // the design's logo, as the page draws it (a card whose logo doesn't load still draws, without it)
      var logo = s.logo && root.AgRpLogo ? root.AgRpLogo.load(s.logo).then(function (got) {
        if (!s.logoInk) return { href: got.url, w: got.w, h: got.h };
        return root.AgRpLogo.inkUrl(got.url, root.AgRainArt.INK).then(function (u) { return { href: u, w: got.w, h: got.h }; });
      }).then(null, function () { return null; }) : null;
      return Promise.all([cmp ? cmp.then(null, function () { return null; }) : null, null, logo]).then(function (res) {
        var ov = null, ext = s.cmp === 'station' ? res[0] : null;
        var byDate = s.cmp === 'normal' ? res[0] : ext && ext.avgByDate && ext.avgByDate.size ? ext.avgByDate : null;
        if (byDate) {
          ov = overlayDaily(days, byDate);
          if (ov) ov.label = s.cmp === 'normal' ? (caD ? '1991\u20132020 average' : 'NOAA 30-year normal') : ext.yearFrom + ' to ' + ext.yearTo + ' station average (' + ext.years + ' years)';
        }
        var qr = null;
        if (!opts.noQr) try { qr = root.AgQR ? { matrix: standardMatrix(), serial: '' } : null; } catch (e) { qr = null; }
        var stuck = s.cmp === 'normal' && res[0] ? stuckRun(days, res[0]) : null;
        var last = days[days.length - 1].date;
        var svg = root.AgRainArt.render({
          style: s.style, year: s.year, place: caD ? CA().placeLong(meta.city, meta.prov, loc.lang) : placeLongOf(meta), name: s.name, dedication: s.dedication, loc: loc,
          days: days, D: picked.d, showDry: showDry(picked.d) && !stuck, axisLen: preview ? (isLeap(s.year) ? 366 : 365) : picked.d.n,
          ov: ov, ovNote: caD ? (s.cmp === 'normal' && CA().normalFrom(chosen.sid) ? (CA().normalFrom(chosen.sid).own ? CA().words(loc.lang).usualNote() : (loc.lang === 'fr' ? 'Année normale : moyenne 1991\u20132020 à ' : 'A usual year: the 1991\u20132020 average at ') + CA().normalFrom(chosen.sid).name) : '') : cmpNoteFor(s.cmp, ext),
          showNormals: s.normals, markers: markersOn(s.markers, s.year, picked.d.n),
          records: [], qr: qr, preview: preview ? { last: last, later: opts.later || '' } : null, gauge: caD ? CA().gaugeLine(meta, loc.lang) : gaugeLine(meta), logo: res[2] || null,
          watermark: false, bleed: 0, idPrefix: opts.idPrefix || 'gc'
        });
        return { svg: svg, last: last, year: s.year, place: caD ? CA().placeLong(meta.city, meta.prov, loc.lang) : placeLongOf(meta), station: chosen.sid, days: days.length, preview: preview };
      });
    });
  }

  /* PAID (2026-10-14, Sig: Stripe checkout in the same tab). Each Payment Link
     sends the buyer back to rain-print?paid=<framed12x18|print12x18|digital>
     &s={CHECKOUT_SESSION_ID} (the setting is in TODO-SIG.md). paidFromUrl
     reads it: {choice, session ('' unless it looks like Stripe's cs_ id)}, or
     null. paidText says what happens next, as paragraphs: o = {choice, today
     (YYYY-MM-DD, Chicago), prices (data/rain-print.json), saved (the design
     saved at the press: {choice, place, year, gift, settle}, or null)}. The
     proof or the file date is the next business day (proof_business_days, the
     same holidays as the Christmas dates). The order line is left off when the
     saved design is missing or was for another product. */
  var PAID_WHAT = { framed12x18: 'framed print', print12x18: '13 x 19 print', digital: 'digital file' };
  var WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function dayWords(iso) { return WEEKDAY[new Date(iso + 'T12:00:00Z').getUTCDay()] + ', ' + shortDate(iso); }
  // "Ordered today, it should arrive by about Mon, Nov 2." for a print or framed print; '' for the file
  function arriveText(j, id, todayIso) {
    var d = id === 'digital' ? '' : arriveBy(j, id, todayIso);
    return d ? 'Ordered today, it should arrive by about ' + dayWords(d) + '.' : '';
  }
  function paidFromUrl(search) {
    var q = new URLSearchParams(String(search || '').replace(/^\?/, '')), c = q.get('paid'), sid = q.get('s') || '';
    if (!PAID_WHAT[c]) return null;
    return { choice: c, session: /^cs_[A-Za-z0-9_]{8,250}$/.test(sid) ? sid : '' };
  }
  function paidText(o) {
    var id = o.choice, j = o.prices || {}, hol = holidaysFor(j, o.today), file = id === 'digital';
    var sv = o.saved && o.saved.choice === id ? o.saved : null, ship = Number.isInteger(j.ship_business_days) ? j.ship_business_days : 3;
    var pd = Number.isInteger(j.proof_business_days) ? j.proof_business_days : 1;
    var by = /^\d{4}-\d{2}-\d{2}$/.test(String(o.today || '')) ? dayWords(addBizDays(o.today, pd, hol)) : '';
    var what = sv && sv.place && sv.year ? 'Your ' + PAID_WHAT[id] + ' of ' + sv.place + ', ' + sv.year + ' is ordered. ' : '';
    var out = [];
    if (sv && sv.gift) {
      out.push(what + 'Your gift card to print comes by email' + (by ? ' by ' + by : ' within 1 business day') + '. ' +
        (file ? 'The finished file follows in January, once the full year is in.' : 'The print follows in January, with a proof to you first.'));
    } else if (sv && sv.settle) {
      out.push(what + 'NOAA doesn\u2019t have all of ' + sv.year + ' in yet. I make it once the full year is in, and email you the ' + (file ? 'finished file' : 'proof') + ' from sig@farmers1st.com then.' +
        (file ? ' Want anything changed? Reply and I\u2019ll redo it, no charge.' : ' Reply OK, or tell me what to change. It ships within ' + ship + ' business days after your OK.'));
    } else if (file) {
      out.push((what ? what + 'The finished file' : 'The finished file') + ' comes by email' + (by ? ' by ' + by : ' within 1 business day') + '. Want anything changed? Reply and I\u2019ll redo it, no charge.');
    } else {
      out.push(what + 'I email you a proof from sig@farmers1st.com' + (by ? ' by ' + by : ' within 1 business day') + '. Reply OK, or tell me what to change.');
      var cut = j[id === 'framed12x18' ? 'framed_christmas_cutoff' : 'print_christmas_cutoff'], t = String(o.today || ''), xm = '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(cut || '') && t >= cut.slice(0, 4) + '-10-01' && t <= cut.slice(0, 4) + '-12-25')
        xm = t <= cut ? ', and ordered by ' + shortDate(cut) + ' it arrives by Christmas.' : '. Ordered now, it arrives after Christmas.';
      out.push('It ships within ' + ship + ' business days after your OK' + (xm || '.'));
    }
    out.push(by && !(sv && sv.settle) ? 'Nothing by then? Check spam, or write to me at sig@farmers1st.com.' : 'Questions? Write to me at sig@farmers1st.com.');
    return out;
  }

  /* EMAIL ME WHEN THE YEAR IS FINISHED (2026-10-19, board Bet 1). The county
     the town lookup put the place in (Open-Meteo's admin2, "Barron County" or
     "Barron"), matched to one county in that state's data/rain/<st>.json, the
     same file the county rain pages and scripts/send_rain_year.py read. Exactly
     one match gives its FIPS; none, or more than one, gives '' and the page
     asks nothing (no guess). */
  function countyKey(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\bst\.?\s+/g, 'saint ').replace(/\bste\.?\s+/g, 'sainte ')
      .replace(/\s+(county|parish|borough|census area|city and borough|municipality)$/, '').replace(/[^a-z]/g, '');
  }
  function countyFips(admin2, counties) {
    var k = countyKey(admin2), hit = '';
    if (!k || !counties || typeof counties !== 'object') return '';
    for (var f in counties) {
      if (!/^\d{5}$/.test(f) || !counties[f] || countyKey(counties[f].name) !== k) continue;
      if (hit) return '';
      hit = f;
    }
    return hit;
  }

  var api = { countyFips: countyFips, encodeCode: encodeCode, decodeCode: decodeCode, toParams: toParams, fromParams: fromParams,
    designUrl: designUrl, shortUrl: shortUrl, STANDARD_LINK: STANDARD_LINK, SHEET: SHEET, sheetBoxes: sheetBoxes, safeInArt: safeInArt, standardMatrix: standardMatrix, normalize: normalize, defaults: defaults, dayIndex: dayIndex, LIMITS: LIMITS, STYLES: Object.keys(STYLE),
    chicagoToday: chicagoToday, yearMode: yearMode, lastRecorded: lastRecorded, cutoffNote: cutoffNote, GIFT_PREFIX: GIFT_PREFIX,
    bizCutoffNote: bizCutoffNote, bizChristmasLine: bizChristmasLine, bizTownCheck: bizTownCheck, uspsHolidays: uspsHolidays, holidaysFor: holidaysFor, christmasCutoff: christmasCutoff, arriveBy: arriveBy, arriveText: arriveText, addBizDays: addBizDays, shortDate: shortDate, bizRows: bizRows, bizRowFor: bizRowFor, bizRange: bizRange, bizQuote: bizQuote, bizQuoteMax: function (j) { return bizQuoteMax(j, bizTiers(j && j.business_tiers)); }, BIZ_MIN: BIZ_MIN, BIZ_MAX: BIZ_MAX,
    printable: printable, hasUnprintable: hasUnprintable, dateProblems: dateProblems, dayProblem: dayProblem, LABEL_PRESETS: LABEL_PRESETS, checkoutRef: checkoutRef, orderRecord: orderRecord, shortRefOf: shortRefOf, cutLabels: cutLabels, linkProblem: linkProblem, sidPlain: sidPlain, stationName: stationName, stationParts: stationParts, stationLabel: stationLabel, milesText: milesText, geoPick: geoPick, geocodeQuery: geocodeQuery, shorterPlaces: shorterPlaces, placeLabel: placeLabel,
    parsePcpn: parsePcpn, snowTraceRaw: snowTraceRaw, derive: derive, previewArt: previewArt, paidText: paidText, paidFromUrl: paidFromUrl, dayWords: dayWords, markersOn: markersOn, placeLongOf: placeLongOf, cmpNoteFor: cmpNoteFor, closeOpenS: closeOpenS, pngWithDpi: pngWithDpi, showDry: showDry, DRY_MIN: DRY_MIN, stuckRun: stuckRun, STUCK_DAYS: STUCK_DAYS, STUCK_USUAL: STUCK_USUAL, stationNormal: stationNormal, stationExtremes: stationExtremes, pickStation: pickStation, snowStateOf: snowStateOf, snowCount: snowCount, snowCountry: snowCountry, snowLimitKm: snowLimitKm, pickWhy: pickWhy, snowWord: snowWord, SNOW_SLACK_MI: SNOW_SLACK_MI, overlayDaily: overlayDaily, stairPath: stairPath, riserSpan: riserSpan, locOf: locOf, isCanada: isCanada, orderPrices: orderPrices, daily: daily, stations: stations, geoFind: geoFind,
    cropInput: cropInput, tempInput: tempInput, histInput: histInput, withoutTemp: withoutTemp, tempStationOk: tempStationOk, tempWords: tempWords, TEMP_KINDS: TEMP_KINDS, HIST_MIN: HIST_MIN, TEMP_GAP_OK: TEMP_GAP_OK, OPT_FLAGS: OPT_FLAGS };
  root.RainPrint = api;
  if (!root.document || !root.document.getElementById('rp-form')) return;

  // ---------------------------------------------------------------- the page
  var doc = root.document;
  var $ = function (id) { return doc.getElementById(id); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* Print sizes, landscape: trim width and height in inches. The art is 1800 x 1200 units, 100 to the inch. */
  var PRINT = { '12x18': { w: 18, h: 12, label: '12 x 18 in' } };
  var DPI = 300;
  var SHEET_WORDS = SHEET.h + ' x ' + SHEET.w + ' in sheet, the art ' + SHEET.art.w + ' x ' + SHEET.art.h + ' in in the middle, untrimmed';
  /* MAKER MODE, GATED (2026-10-17, art panel: ?maker=1 alone showed anyone the
     print and digital file buttons, which gave away the $19 file). Sig opens
     ?maker=<his key> once on a browser: the page compares the key's SHA-256
     with MAKER_HASH, keeps a flag in this browser's localStorage, and reloads
     as ?maker=1, so the key leaves the address bar. From then on ?maker=1
     (with &serial=N or &serial=0) works on that browser; anywhere else
     ?maker=1 is the public page. Only the hash is in this file, never the key.
     This stops casual use. It is not DRM: the hash and the flag are both in
     this public file, and anyone who reads it can set the flag and draw the
     files themselves. */
  var MAKER_HASH = 'd13c567a9e183ee53f5f263b90610b99e05c0a7bdb27e26940c19683ca1c30d3', MAKER_FLAG = 'rp-maker';
  var MAKER_ASK = /(?:^|[?&])maker=([^&#]+)/.exec(root.location.search);
  var MAKER = (function () {
    if (!MAKER_ASK) return false;
    try { return root.localStorage.getItem(MAKER_FLAG) === MAKER_HASH; } catch (e) { return false; }
  })();
  function sha256Hex(text) {
    var c = root.crypto && root.crypto.subtle;
    if (!c || typeof TextEncoder !== 'function') return Promise.resolve('');
    return c.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    }, function () { return ''; });
  }
  if (MAKER_ASK && MAKER_ASK[1] !== '1') {
    var makerOne = function () { return root.location.href.replace(/([?&])maker=[^&#]+/, '$1maker=1'); };
    if (MAKER) { try { root.history.replaceState(root.history.state, '', makerOne()); } catch (e) {} }
    else {
      var key = MAKER_ASK[1];
      try { key = decodeURIComponent(key); } catch (e) {}
      sha256Hex(key).then(function (h) {
        if (h !== MAKER_HASH) return;
        try { root.localStorage.setItem(MAKER_FLAG, MAKER_HASH); } catch (e) { return; }
        root.location.replace(makerOne());
      });
    }
  }
  var CHOICE = { digital: 'Digital file', print12x18: '13 x 19 print', framed12x18: '13 x 19 framed print' };
  var PRODUCTS = ['digital', 'print12x18', 'framed12x18'];
  var ORDER_TO = 'sig@farmers1st.com';

  var ST = fromParams(root.location.search);
  var EXT_WAIT = false, NORM_WAIT = false, BUY_NOTE_CODE = '', XMAS_OFF = true;
  /* A NOAA ask that failed or timed out (its error carries retry), keyed
     'norm|sid|year' and 'por|sid' (2026-10-19, Rain Print audit: a 500 or a
     15 s timeout on the normal read as "This station has no NOAA normal" and
     the maker file, the digital file and the order all went out without the
     line). A station with no normal (ACIS's error reply) has no retry flag and
     is not listed: that print is fine as it is. LOAD_FAIL itself is
     declared with NORM_CACHE, since the fetches fill it without a page. */
  /* -> what the design asks for that didn't load, in words, or ''. While it is
     set, ordering and the maker's files stay shut until Draw brings it in. */
  function loadFail() {
    if (!DATA || !META || SAMPLE) return '';
    var porOut = !(EXT && EXT.rows) && !EXT_WAIT && LOAD_FAIL.has('por|' + META.sid);
    if (ST.cmp === 'normal' && !NORM30 && !NORM_WAIT && LOAD_FAIL.has('norm|' + META.sid + '|' + ST.year)) return 'The usual-year line didn\u2019t load.';
    if (ST.cmp === 'station' && porOut) return 'The station history didn\u2019t load, so the usual-year line is missing.';
    if (ST.records && !PREVIEW && root.AgRainRecords && porOut) return 'The station history didn\u2019t load, so the remarkable days are missing.';
    if (wantHist() && FULL_CACHE.has(META.sid) && FULL_CACHE.get(META.sid) === null && LOAD_FAIL.has('por|' + META.sid)) return 'The station history didn\u2019t load, so the years strip is missing.';
    if (wantTemp() && TEMP && TEMP.failed) return 'The temperature records didn\u2019t load.';
    return '';
  }
  var DATA = null, META = null, EXT = null, NORM30 = null, STATIONS = [], PRICES = null, PRICES_P = null, BLOCKED = '', DRAWING = false;
  var SNOW_SEEN = {};   // {year: {sid: 'full'|'none'|'unknown'}}: each station's snowfall year once its days are read (the station list's words)
  /* This year only. PREVIEW: {last: ISO date of the last recorded day, yearLen}
     while a year-to-date preview is drawn. NOART: the plain message shown
     instead of art when the year so far is too thin to draw; ordering stays open. */
  var PREVIEW = null, NOART = '';
  /* SETTLE: last year, drawn while it is still open (lastYearOpen) and not all
     in, or before full_year_from: ordered now, made once the full year is in. */
  var SETTLE = false;
  var STUCK = null;   // stuckRun() of the drawn year, once the normal is in
  /* SAMPLE (2026-10-11): with no design in the URL the page draws Chetek, WI
     for the last finished year, through the same geocode and ACIS calls a
     reader's own town takes, so the box is never empty. A sample cannot be
     ordered: the buy buttons stay off, nothing goes into the URL or the order
     form, and the town field stays empty, until the reader draws their own
     place or clicks "Use this design". Any failure puts the empty box back. */
  var SAMPLE = null;
  /* THE EXAMPLE (2026-10-14, Sig: example words are gray hints only, never
     pre-filled on a buyer's print). The boxes start empty, with the example as
     their placeholders. Until the reader does something with the page, the
     print at the top wears the example words, labeled as an example under it
     (SHOW_EX); the design itself (ST: the URL, the up-close view, the order)
     never carries them. A word typed, a draw, Up close or the pay button takes
     them off. A design from a link never shows them. The old guard at the Order button and
     its clear button went with the pre-fill. */
  var EXAMPLE = { name: 'The Johnson Farm', dedication: 'For Dad, his 40th crop. Love, Kate',
    markers: [{ md: '05-08', label: 'Planted' }, { md: '07-12', label: 'Hail' }, { md: '10-24', label: 'Harvest done' }] };
  var SHOW_EX = false;
  function exampleMarkers(year) { return EXAMPLE.markers.map(function (m) { return { date: year + '-' + m.md, label: m.label }; }); }
  function endExample() {
    if (!SHOW_EX) return;
    SHOW_EX = false;
    if (DATA && !BLOCKED) render(); else sampleLine(!!SAMPLE);
  }

  // var EXT_CACHE, NORM_CACHE and DAILY_CACHE live with the data calls above the page, shared with the gift card

  // smooth scrolling, unless the reader asked for less motion
  function smooth() { try { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; } catch (e) { return 'smooth'; } }
  function ga(n, p) { try { if (root.gaEvent) root.gaEvent(n, p); else if (root.gtag) root.gtag('event', n, p); } catch (e) {} }
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  /* ---------- Canada on the page (2026-10-16; components/rp-canada.js) ----------
     caPage: the design is Canadian (its drawn station, its town or its station id).
     LOC(): what the print and these words are in (locOf). FR(): French page words.
     L(en, fr): the words for the page in the design's language. */
  function caPage() { return META && !DRAWING ? !!META.ca : isCanada(ST.place) || isCanada(ST.station) || !!(META && META.ca && META.sid === ST.station); }
  /* The units and language switches, the page's French, and the line about ordering
     from Canada: shown for a Canadian design, put away for a US one. */
  function syncCa() {
    var ca = caPage() && !SAMPLE, box = $('rp-ca');
    if (!box) return;
    box.hidden = !ca;
    $('rp-ca-hint').hidden = ca;
    // the US story links don't help a Canadian draw
    if ($('rp-stories')) $('rp-stories').hidden = ca;
    var lc = LOC();
    if (META && META.ca) META.lang = lc.lang;
    radios('rp-units').forEach(function (r) { r.checked = ca && r.value === lc.units; });
    radios('rp-lang').forEach(function (r) { r.checked = ca && r.value === lc.lang; });
    GEO_LANG = ca ? lc.lang : 'en';
    if (CA()) CA().applyPage(doc, lc.lang, ca);
    var c = (PRICES && PRICES.canada) || {}, note = $('rp-ca-ship');
    if (note) {
      var open = c.ships === true;
      note.textContent = !ca ? '' : open ? L('Prices are in US dollars and include shipping to Canada. GST/HST is collected on delivery.', 'Les prix sont en dollars américains, livraison au Canada comprise. La TPS/TVH est perçue à la livraison.') + L('', ' Le paiement et les courriels de commande sont en anglais.')
        : L('Shipping prints and framed prints to Canada starts soon. The digital file works today: $19 US, by email within 1 business day.', 'L’envoi des tirages et des tirages encadrés au Canada commence bientôt. Le fichier numérique est offert dès maintenant : 19 $ US, par courriel en 1 jour ouvrable.') +
          L('', ' Le paiement et les courriels de commande sont en anglais.');
      note.hidden = !ca;
    }
    // a Canadian design can't pick what doesn't ship there yet
    var blocked = OJ().blocked;
    radios('rp-product').concat(radios('rp-pproduct')).forEach(function (r) {
      var no = blocked.indexOf(r.value) >= 0;
      r.disabled = no;
      var lab = r.closest('label');
      if (lab) lab.classList.toggle('rp-prod-off', no);
    });
    Array.prototype.forEach.call($('ro-choice').options, function (o) { o.disabled = blocked.indexOf(o.value) >= 0; });
    if (blocked.indexOf($('ro-choice').value) >= 0) $('ro-choice').value = 'digital';
    if (blocked.indexOf(PICK) >= 0) setPick('digital');
  }
  function caProv() { return (META && META.prov) || ((CA() && CA().parseQuery(ST.place)) || {}).prov || ''; }
  function LOC() { return locOf(ST, caPage(), caProv()); }
  function FR() { return caPage() && LOC().lang === 'fr'; }
  function L(en, fr) { return FR() ? fr : en; }
  function caWords() { return CA() ? CA().words(LOC().lang) : null; }
  // what "a usual year" is at a Canadian station: its own 1991-2020 averages, or the nearest station's (named)
  function caUsual(sid) {
    var f = CA() && CA().normalFrom(sid), fr = FR();
    if (!f) return '';
    if (f.own) return caWords().usualNote();
    return (fr ? 'Année normale : moyenne 1991\u20132020 à ' : 'A usual year: the 1991\u20132020 average at ') + f.name + ', ' + CA().kmText(f.km, LOC().lang) + (fr ? ' plus loin' : ' away');
  }
  function caOrder() { return caPage(); }
  function OJ() { return orderPrices(PRICES, caOrder()); }
  function blockedPick(id) { return OJ().blocked.indexOf(id) >= 0; }

  // ---------- derived ----------
  function overlayKey() { return ST.cmp === 'normal' ? 'normal30' : ST.cmp === 'station' ? 'full' : ''; }
  // The chosen comparison as daily amounts + running total, aligned to the year, or null.
  function overlaySeries() {
    var key = overlayKey();
    if (!key || !DATA) return null;
    var byDate, label;
    if (key === 'normal30' && NORM30) { byDate = NORM30; label = META && META.ca ? caUsual(META.sid).replace(/^[^:]*: /, '') : 'NOAA 30-year normal'; }
    else if (key === 'full' && EXT && EXT.avgByDate.size) { byDate = EXT.avgByDate; label = EXT.yearFrom + L(' to ', ' à ') + EXT.yearTo + L(' station average (', ', moyenne de la station (') + EXT.years + L(' years)', ' ans)'); }
    else return null;
    var o = overlayDaily(DATA.days, byDate);
    if (!o) return null;
    o.label = label;
    return o;
  }
  // ---------- the art (components/rain-print-art.js draws it) ----------
  function fmtDate(iso) { if (!iso) return ''; var p = iso.split('-').map(Number); return MON[p[1] - 1].toUpperCase() + ' ' + p[2]; }
  function printMarkers() { return DATA ? markersOn(ST.markers, META.year, DATA.d.n) : []; }
  // "Chetek, Wisconsin": the state written out on the print
  function placeLong() { return META && META.ca && CA() ? CA().placeLong(META.city, META.prov, LOC().lang) : placeLongOf(META); }
  /* The reader's days with no words of their own print as their date: in French, "3 mai". */
  function locMarkers(list) {
    if (!FR()) return list;
    var MF = root.AgRainArt && root.AgRainArt.MON_FR, EN = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d+)$/;
    return list.map(function (m) {
      var x = EN.exec(m.label || '');
      return x && MF ? Object.assign({}, m, { label: (x[2] === '1' ? '1er' : x[2]) + ' ' + MF[MON3.indexOf(x[1])] }) : m;
    });
  }

  /* The maker's mark: a real QR code (components/qr.js, level M), square to the
     page, warm gray on the paper. On everything a buyer sees before paying (the
     page, the up-close view, the mini copy, the preview PNG) it is the standard
     code to the Rain Print page (STANDARD_LINK), and no short link is asked for
     (2026-10-14, Sig: a working QR only once someone pays; the old mint on every
     redraw also ran the link service into its hourly limit). The print's own
     short link (components/rp-short.js, 25 x 25 modules) is made only when Sig
     saves an order file (exportFile, o.qrMatrix), and that file waits for it. */
  // The design itself, without the gift marker: what the QR and shared links open.
  function artDesign() { return Object.assign({}, ST, { gift: false }); }
  function qrInfo(serial, own) {
    var m = own || null;
    if (!m) try { m = standardMatrix(); } catch (e) { m = null; }
    return m ? { matrix: m, serial: serial || '' } : null;
  }
  /* The serial goes under the QR on a physical print only: Sig's print files
     with ?maker=1&serial=N. Never on the digital file, never on the public page.
     serial=0 is "No. 0000", Sig's own test prints (Oct 17, 2026); orders start at 1. */
  var SERIAL = (function () {
    var m = /(?:^|[?&])serial=(\d{1,6})(?:&|$)/.exec(root.location.search);
    return MAKER && m ? 'No. ' + String(+m[1]).padStart(4, '0') : '';
  })();

  function cmpNote() {
    if (META && META.ca) {
      if (ST.cmp === 'normal') return caUsual(META.sid);
      if (ST.cmp === 'station' && EXT) return L('A usual year: this station\u2019s average, ', 'Année normale : moyenne de cette station, ') + EXT.yearFrom + L(' to ', ' à ') + EXT.yearTo;
    }
    return cmpNoteFor(ST.cmp, EXT);
  }
  /* o: {bleed (art units, 100 to the inch), watermark, px [w,h], fontCss, serial, idPrefix,
     example (the page's own preview only: the example words in place of the reader's, while SHOW_EX)}. */
  function buildSvg(o) {
    o = o || {};
    var ex = !!o.example;
    var svg = root.AgRainArt.render(artInput(o));
    SKIPPED = root.AgRainArt.lastSkipped();
    UNPLACED = ex ? [] : unplacedRows();
    return svg;
  }
  // what the art is drawn from: the page, every export and the insert letter share it
  function artInput(o) {
    o = o || {};
    var ex = !!o.example;
    return {
      style: ST.style, year: META.year, place: placeLong(), name: ex ? EXAMPLE.name : ST.name, dedication: ex ? EXAMPLE.dedication : ST.dedication,
      days: DATA.days, D: DATA.d, showDry: showDry(DATA.d) && !STUCK, axisLen: PREVIEW ? PREVIEW.yearLen : DATA.d.n,
      ov: overlaySeries(), ovNote: cmpNote(), showNormals: ST.normals, markers: locMarkers(ex ? markersOn(exampleMarkers(META.year), META.year, DATA.d.n) : printMarkers()),
      records: ST.records && !STUCK ? withoutTemp(recordsFor(), ST) : [], qr: qrInfo(o.serial, o.qrMatrix), preview: PREVIEW ? { last: PREVIEW.last } : null,
      crop: extrasCrop(), temp: extrasTemp(), hist: extrasHist(),
      gauge: META ? gaugeLine(META) : '', logo: logoArt(), loc: META && META.ca ? LOC() : null,
      watermark: !!o.watermark, bleed: o.bleed || 0, px: o.px, fontCss: o.fontCss, idPrefix: o.idPrefix
    };
  }
  /* Marked days the art could not place cleanly, as day numbers on the page,
     so that day's row can say so (2026-10-15, up to five days). The art names
     them by index into the markers it was given (AgRainArt.lastUnplaced, art
     v11: the first three always draw; a 4th or 5th that can only land on top
     of the others is left off). The k-th marker given is the k-th of ST.markers that falls
     on the days drawn, and ST.markers come from the rows with a day, in order. */
  var UNPLACED = [];
  function unplacedRows() {
    var A = root.AgRainArt, idx = [], src = [], rows = [];
    if (A && typeof A.lastUnplaced === 'function') idx = A.lastUnplaced() || [];
    if (!idx.length || !DATA || !META) return [];
    ST.markers.forEach(function (m, j) { var doy = dayIndex(META.year, m.date); if (doy >= 0 && doy < DATA.d.n) src.push(j); });
    dayNums().forEach(function (i) { var d = rowDate(i, ST.year); if (d && dayIndex(ST.year, d) >= 0) rows.push(i); });
    return idx.map(function (k) { return rows[src[k]]; }).filter(Boolean);
  }
  function unplacedWords(i) { return 'Day ' + i + ' is too close to the others to fit; move it or remove one.'; }

  /* Remarkable days (opt-in): components/rain-print-records.js reads the year's
     daily rows and the period of record this page already downloaded. Loaded on
     first use. */
  var SKIPPED = [], RECS_KEY = '', RECS = [], RECS_P = null;
  function recordsReady() {
    if (root.AgRainRecords) return Promise.resolve(true);
    if (RECS_P) return RECS_P;
    RECS_P = new Promise(function (res) {
      var sc = doc.createElement('script');
      sc.src = '/components/rain-print-records.js?v=4';
      sc.onload = function () { res(!!root.AgRainRecords); };
      sc.onerror = function () { RECS_P = null; res(false); };
      doc.head.appendChild(sc);
    });
    return RECS_P;
  }
  function recordsFor() {
    if (!root.AgRainRecords || !DATA || !DATA.raw || PREVIEW) return [];
    var key = META.sid + '|' + META.year + '|' + (EXT && EXT.rows ? EXT.rows.length : 0);
    if (key !== RECS_KEY) {
      RECS_KEY = key;
      try {
        RECS = root.AgRainRecords.find({ year: META.year, sid: META.sid, daily: DATA.raw, por: EXT && EXT.rows ? EXT.rows : null,
          dailyElems: ['pcpn', 'avgt', 'snow', 'maxt', 'mint'], porElems: ['pcpn', 'avgt'] }, {});
      } catch (e) { RECS = []; }
    }
    // a Canadian print: its remarkable days in its units and language (components/rp-canada.js)
    return CA() && META && META.ca ? CA().localizeRecords(RECS, LOC()) : RECS;
  }

  // ---------------------------------------------------------------- the 2026-10-17 options
  /* TEMP: the temperature station's year for the print drawn (META.sid|year): {sid, td, rows, tm, norm, found}
     or {none: why}. Read after the print draws (extrasLoad), never holding it up; the print draws again when
     it is in. The gauge's own highs and lows are used when it keeps them; else the nearest station that does
     (StnMeta maxt over the same box), up to three read, nearest first. */
  var TEMP = null, TEMP_KEY = '', TEMP_P = null, HIST_WHY = '', FULL_CACHE = new Map(), EXTRAS_P = null;
  // the maker's files wait for the options' data, so the file Sig prints shows what the buyer saw
  function extrasGate() { return Promise.resolve(EXTRAS_P).then(function () { return true; }, function () { return true; }); }
  var TEMP_ELEMS = ['pcpn', 'avgt', 'snow', 'maxt', 'mint'];
  function wantTemp() { return !!(ST.crop || ST.frost || ST.heat || ST.ribbon); }
  function wantHist() { return !!(ST.hist && ST.style !== 'r2'); }
  function extrasReady() {
    if (root.AgRainExtras && root.AgGduStages) return Promise.resolve(true);
    var one = function (src, ok) { return ok() ? Promise.resolve(true) : new Promise(function (res) { var sc = doc.createElement('script'); sc.src = src; sc.onload = function () { res(ok()); }; sc.onerror = function () { res(false); }; doc.head.appendChild(sc); }); };
    return one('/components/gdu-stages.js?v=1', function () { return !!root.AgGduStages; }).then(function () { return one('/components/rain-print-extras.js?v=1', function () { return !!root.AgRainExtras; }); });
  }
  function tempNormal(sid, year) {
    var params = JSON.stringify({ sid: sid, sdate: year + '-01-01', edate: year + '-12-31', elems: [{ name: 'maxt', normal: '91' }, { name: 'mint', normal: '91' }] });
    return safeFetch('https://data.rcc-acis.org/StnData?params=' + encodeURIComponent(params)).then(function (r) { return r.json(); })
      .then(function (j) { return j && !j.error && Array.isArray(j.data) ? root.AgRainExtras.normalTemps(j.data, year) : null; }, function () { return null; });
  }
  function tempStationsNear(lat, lon, year) {
    var d = 0.6, box = [lon - d, lat - d, lon + d, lat + d].map(function (x) { return x.toFixed(3); }).join(',');
    var u = 'https://data.rcc-acis.org/StnMeta?' + new URLSearchParams({ bbox: box, elems: 'maxt', sdate: year + '-01-01', edate: lastDayOf(year), meta: 'name,sids,ll,valid_daterange' });
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
      return (j.meta || []).filter(function (m) { return m.ll && m.sids && m.sids[0] && m.valid_daterange && m.valid_daterange[0] && m.valid_daterange[0][0] <= year + '-01-01'; })
        .map(function (m) { return { sid: cleanSid(m.sids[0]), name: m.name, km: haversine(lat, lon, m.ll[1], m.ll[0]) }; }).sort(function (a, b) { return a.km - b.km; });
    });
  }
  function extrasLoad(my) {
    if (!DATA || !META || BLOCKED) return;
    var key = META.sid + '|' + META.year + '|' + (PREVIEW ? PREVIEW.last : '');
    var go = wantTemp() || wantHist();
    if (!go) { syncExtrasUi(); return; }
    EXTRAS_P = extrasReady().then(function (ok) {
      if (!ok || my !== reqToken) return null;
      var jobs = [];
      if (wantHist() && !FULL_CACHE.has(META.sid)) jobs.push(stationExtremes(META.sid).then(function (x) { FULL_CACHE.set(META.sid, root.AgRainExtras.fullYears(x.rows, 1)); }, function () { FULL_CACHE.set(META.sid, null); }));
      if (wantTemp() && TEMP_KEY !== key) { TEMP_KEY = key; TEMP = null; TEMP_P = tempFind(key); }
      if (wantTemp()) jobs.push(TEMP_P.then(function () { return ST.crop && ST.ghost && TEMP && TEMP.sid && TEMP.norm === undefined ? tempNormal(TEMP.sid, META.year).then(function (n) { TEMP.norm = n; }) : null; }));
      if (ST.frost || ST.heat) jobs.push(recordsReady());
      return Promise.all(jobs);
    }).then(function () { if (my === reqToken && DATA) { syncExtrasUi(); render(); } });
  }
  function tempFind(key) {
    var X = root.AgRainExtras, year = META.year, last = PREVIEW ? DATA.days.length - 1 : undefined;
    var mine = X.tempDays(DATA.raw, year);
    if (META.ca || tempStationOk(mine, last)) {
      TEMP = tempStationOk(mine, last) ? { sid: META.sid, td: mine, rows: DATA.raw, tm: { same: true } } : { none: 'This station keeps no daily highs and lows for ' + year + ', so frost, the hottest and coldest day, crop stages and the temperature band are off.' };
      return Promise.resolve(TEMP);
    }
    var town = META.city;
    /* First the rain stations already listed (most of them were read for the print already, so no new ask),
       the five nearest; then, if none kept highs and lows, NOAA's list of stations that do, the three nearest. */
    var tryList = function (c) {
      return Promise.all(c.map(function (x) { return daily(x.sid, year).then(function (d) { return d; }, function () { return null; }); })).then(function (ds) {
        var best = null;
        c.forEach(function (x, i) {
          if (best || !ds[i]) return;
          var td = X.tempDays(ds[i].raw, year);
          if (tempStationOk(td, last)) best = { sid: x.sid, td: td, rows: ds[i].raw, tm: { same: false, name: stationName(ds[i].meta.name || x.name), words: tempAway(x.km) } };
        });
        return best;
      });
    };
    var near = STATIONS.filter(function (x) { return x.sid !== META.sid && !(CA() && CA().isSid(x.sid)); }).slice(0, 5);
    return tryList(near).then(function (best) {
      if (best) return best;
      return tempStationsNear(META.lat, META.lon, year).then(function (list) {
        return tryList(list.filter(function (x) { return x.sid !== META.sid && !near.some(function (n) { return n.sid === x.sid; }); }).slice(0, 3));
      });
    }).then(function (best) {
      if (TEMP_KEY !== key) return;
      TEMP = best || { none: 'No weather station near ' + town + ' kept daily highs and lows for ' + year + ', so frost, the hottest and coldest day, crop stages and the temperature band are off.' };
    }).then(null, function () { if (TEMP_KEY === key) { TEMP = { none: 'The temperature records didn’t load just now, so frost, the hottest and coldest day, crop stages and the temperature band are off. Try again in a minute.', failed: true }; TEMP_KEY = ''; } });
  }
  function tempFound() {
    if (!TEMP || !TEMP.td || !root.AgRainRecords) return [];
    if (TEMP.found === undefined) { try { TEMP.found = root.AgRainRecords.find({ year: META.year, sid: TEMP.sid, daily: TEMP.rows, dailyElems: TEMP_ELEMS }, { kinds: TEMP_KINDS }); } catch (e) { TEMP.found = []; } }
    return TEMP.found;
  }
  function extrasCrop() { return ST.crop && TEMP && TEMP.td ? cropInput(ST, TEMP.td, TEMP.norm || null) : null; }
  function extrasTemp() { return TEMP && TEMP.td ? tempInput(ST, TEMP.td, tempFound(), TEMP.tm, !!ST.crop) : null; }
  function extrasHist() { return wantHist() && META && FULL_CACHE.get(META.sid) ? histInput(FULL_CACHE.get(META.sid), META.year) : null; }
  /* Every year behind: the nearest station whose full record reaches HIST_MIN full years and whose year is good
     (at most MISS_OK unrecorded days), from those whose record spans 30 years or more, up to four read. */
  function pickLong(list, year, onTry) {
    var yrs = function (s) { var r = s.valid_daterange && s.valid_daterange[0]; return r ? +r[1].slice(0, 4) - +r[0].slice(0, 4) + 1 : 0; };
    var cands = list.filter(function (s) { return yrs(s) >= HIST_MIN && !(CA() && CA().isSid(s.sid)); }).slice(0, 4);
    return extrasReady().then(function () {
      var i = 0;
      var next = function () {
        var s = cands[i++];
        if (!s) return null;
        if (onTry) onTry(s);
        return Promise.all([stationExtremes(s.sid), daily(s.sid, year)]).then(function (r) {
          var full = root.AgRainExtras.fullYears(r[0].rows, 1);
          FULL_CACHE.set(s.sid, full);
          return full.length >= HIST_MIN && r[1].d.missing <= MISS_OK ? { chosen: s, picked: r[1] } : next();
        }, next);
      };
      return next();
    });
  }
  // the options panel: what each switch can do for this print, and why one can't
  function syncExtrasUi() {
    var say = function (id, t) { var el = $(id); if (el) { el.textContent = t || ''; el.hidden = !t; } };
    var tempBox = $('rp-temp-opts');
    if (!tempBox) return;
    var noTemp = TEMP && TEMP.none;
    tempBox.hidden = !!noTemp;
    $('rp-crop-opts').hidden = !!noTemp;
    say('rp-temp-why', noTemp ? TEMP.none : TEMP && TEMP.tm ? (TEMP.tm.same ? 'Temperatures from the same station as the rain.' : 'Temperatures from ' + TEMP.tm.name + ', ' + TEMP.tm.words + ': the nearest station with daily highs and lows for ' + META.year + '.') : '');
    // the crop's days come from the marked days
    syncCropDays();
    var c = extrasCrop();
    say('rp-crop-say', ST.crop && !c && TEMP && TEMP.td ? 'Mark the planting day and the harvest day above, then pick them here.' : c && c.stop === 'missing' ? 'The temperature record has a gap, so no stage after it is drawn.' : '');
    var r2 = ST.style === 'r2', long = STATIONS.some(function (s) { var r = s.valid_daterange && s.valid_daterange[0]; return r && +r[1].slice(0, 4) - +r[0].slice(0, 4) + 1 >= HIST_MIN; });
    $('rp-hist').disabled = r2 || (!long && !!STATIONS.length);
    var full = META ? FULL_CACHE.get(META.sid) : null;
    say('rp-hist-why', r2 ? 'Staircase only: Roots draws each day as its own bar.' : !long && STATIONS.length ? 'No station near here has ' + HIST_MIN + ' years of daily records, so this one can’t be drawn.'
      : HIST_WHY ? HIST_WHY : wantHist() && full && full.length < HIST_MIN ? stationName(META.name) + ' has ' + full.length + ' full years; it takes ' + HIST_MIN + '. Pick the nearest station again under Weather station, or turn this off.' : '');
  }
  function syncCropDays() {
    var opts = '<option value="">Pick a marked day</option>' + ST.markers.map(function (m) { return '<option value="' + esc(m.date) + '">' + esc(shortDate(m.date) + (m.label ? ', ' + m.label : '')) + '</option>'; }).join('');
    ['rp-crop-plant', 'rp-crop-harvest'].forEach(function (id) {
      var el = $(id); if (!el) return;
      var v = id === 'rp-crop-plant' ? ST.cropPlant : ST.cropHarvest;
      if (el.innerHTML !== opts) el.innerHTML = opts;
      el.value = v && ST.markers.some(function (m) { return m.date === v; }) ? v : '';
      el.disabled = !$('rp-crop').value;
    });
    var on = !!$('rp-crop').value;
    $('rp-plants').disabled = !on; $('rp-ghost').disabled = !on;
  }
  // a planting or harvest day among the marked days, by its words, for a crop just picked
  function guessCropDay(re) { var m = ST.markers.filter(function (x) { return re.test(x.label || ''); })[0]; return m ? m.date : ''; }

  // ---------------------------------------------------------------- the logo
  /* LOGO: the picture behind ST.logo, or a file just picked while it saves:
     {id ('' while saving), state 'saving' | 'loading' | 'ready' | 'missing',
     color: {url (data URL), w, h} | null, ink: data URL of the one-color
     version | null, msg}. The design (ST.logo, ST.logoInk) carries only the
     id and the switch; LOGO_ASK drops an answer that came too late. */
  var LOGO = null, LOGO_ASK = 0, LOGO_PPI = 200;
  function inkHex() { return (root.AgRainArt && root.AgRainArt.INK) || '#1E2125'; }
  // what the art draws: the picture in the chosen color, or nothing while it isn't here
  function logoArt() {
    if (!LOGO || !LOGO.color) return null;
    if (LOGO.state !== 'saving' && LOGO.id !== ST.logo) return null;
    var href = ST.logoInk ? LOGO.ink : LOGO.color.url;
    return href ? { href: href, w: LOGO.color.w, h: LOGO.color.h } : null;
  }
  function logoRedraw() { if (DATA && !BLOCKED) render(); else if (!SAMPLE && ST.place) setDesignRefs(); }
  function logoInk(my) {
    return root.AgRpLogo.inkUrl(LOGO.color.url, inkHex()).then(function (u) { if (my === LOGO_ASK && LOGO) LOGO.ink = u; }, function () {});
  }
  // the design's logo, read from the worker when the design names one this page hasn't drawn
  /* rp-logo.js loads when a logo is first wanted (2026-10-17, speed panel: most
     buyers never add one), the way gdu-stages.js and the extras do. */
  var LOGO_P = null;
  function logoReady() {
    if (root.AgRpLogo) return Promise.resolve(true);
    if (!LOGO_P) LOGO_P = new Promise(function (res) {
      var sc = doc.createElement('script');
      sc.src = '/components/rp-logo.js?v=2';
      sc.onload = function () { res(!!root.AgRpLogo); };
      sc.onerror = function () { LOGO_P = null; res(false); };
      doc.head.appendChild(sc);
    });
    return LOGO_P;
  }
  function wantLogo() {
    var id = ST.logo;
    if (!id) { if (LOGO && LOGO.state !== 'saving') LOGO = null; syncLogoUi(); return; }
    if (LOGO && LOGO.id === id) { syncLogoUi(); return; }
    var my = ++LOGO_ASK;
    if (!root.AgRpLogo) {
      LOGO = { id: id, state: 'loading', color: null, ink: null };
      syncLogoUi();
      logoReady().then(function (ok) {
        if (my !== LOGO_ASK) return;
        if (ok) { LOGO = null; wantLogo(); return; }
        LOGO = { id: id, state: 'missing', color: null, ink: null, msg: 'The logo didn\u2019t load.' }; syncLogoUi();
      });
      return;
    }
    LOGO = { id: id, state: 'loading', color: null, ink: null };
    syncLogoUi();
    root.AgRpLogo.load(id).then(function (got) {
      if (my !== LOGO_ASK) return;
      LOGO.color = got; LOGO.state = 'ready';
      return logoInk(my).then(function () { if (my === LOGO_ASK) { syncLogoUi(); logoRedraw(); } });
    }, function (e) {
      if (my !== LOGO_ASK) return;
      LOGO.state = 'missing'; LOGO.msg = e && e.plain ? e.message : 'The logo didn\u2019t load.';
      syncLogoUi();
    });
  }
  function logoMsg(t, bad) { var el = $('rp-logo-msg'); if (!el) return; el.textContent = t || ''; el.classList.toggle('rp-bad', !!bad); }
  function syncLogoUi() {
    if (!$('rp-logo')) return;
    var has = !!LOGO, art = logoArt(), th = $('rp-logo-thumb');
    $('rp-logo-pick').textContent = has ? 'Choose another file' : 'Choose a file';
    $('rp-logo-remove').hidden = !has;
    $('rp-logo-inks').hidden = !(LOGO && LOGO.color);
    radios('rp-logo-ink').forEach(function (r) { r.checked = r.value === (ST.logoInk ? '1' : '0'); });
    if (art) { if (th.getAttribute('src') !== art.href) th.src = art.href; th.hidden = false; } else { th.hidden = true; th.removeAttribute('src'); }
    // Sig's print files page (?maker=1): a link to the file the buyer uploaded (a Stripe order carries only the design)
    var mk = $('rp-maker-logo');
    if (MAKER && mk) { mk.hidden = !ST.logo; if (ST.logo) mk.innerHTML = 'Logo file: <a href="' + LOGO_LINK + ST.logo + '" rel="noopener">' + LOGO_LINK + ST.logo + '</a> (' + (ST.logoInk ? 'printed in the ink color' : 'printed in its own colors') + '); save this file with the order'; }
    if (!LOGO) return;
    if (LOGO.state === 'saving') return logoMsg('Saving the logo\u2026');
    if (LOGO.state === 'loading') return logoMsg('Loading the logo\u2026');
    if (LOGO.state === 'missing') return logoMsg((LOGO.msg || 'The logo didn\u2019t load.') + ' It isn\u2019t on the print. Choose the file again, or remove it.', true);
    // the quality check, in words: under about 200 pixels an inch at its printed size it may print soft
    var c = LOGO.color, A = root.AgRpLogo, sz = root.AgRainArt.logoSize(ST.style, c.w / c.h);
    var soft = A && A.ppi(c.w, c.h, sz.w, sz.h) < LOGO_PPI;
    logoMsg(soft ? 'This logo is small and may print soft. If you have a bigger file, use that; I\u2019ll also check it in your proof.' : 'Logo added. It prints about ' + (sz.h / 100).toFixed(1) + ' in tall, next to the name.', false);
  }
  function pickLogo(file) {
    var A = root.AgRpLogo;
    if (!A || !file) return;
    var my = ++LOGO_ASK, kind = '';
    logoMsg('Reading the logo\u2026');
    A.process(file).then(function (p) {
      if (my !== LOGO_ASK) return;
      kind = p.kind;
      LOGO = { id: '', state: 'saving', color: { url: p.url, w: p.w, h: p.h }, ink: null };
      ST.logo = '';
      syncLogoUi();
      // drawn right away; the design takes the id once the worker has it
      return logoInk(my).then(function () {
        if (my !== LOGO_ASK) return;
        syncLogoUi(); logoRedraw();
        return A.upload(p.blob).then(function (id) {
          if (my !== LOGO_ASK) return;
          LOGO.id = id; LOGO.state = 'ready';
          A.remember(id, LOGO.color);
          ST.logo = id;
          syncLogoUi(); logoRedraw();
          ga('rain_print_logo', { result: 'ok', kind: kind });
        });
      });
    }).catch(function (e) {
      if (my !== LOGO_ASK) return;
      LOGO = null; ST.logo = '';
      syncLogoUi(); logoRedraw();
      logoMsg(e && e.plain ? e.message : 'That logo didn\u2019t work. Try a PNG or JPG copy.', true);
      ga('rain_print_logo', { result: 'fail', kind: kind });
    }).then(function () { try { $('rp-logo-file').value = ''; } catch (err) {} });
  }
  function removeLogo() {
    LOGO_ASK++;
    LOGO = null; ST.logo = '';
    syncLogoUi(); logoMsg('');
    logoRedraw();
    try { $('rp-logo-pick').focus(); } catch (e) {}
  }
  /* A file Sig prints or someone pays for waits for the logo (8 s at most);
     true when it is in, or the design has none. */
  function logoGate() {
    if (!ST.logo || logoArt()) return Promise.resolve(true);
    return new Promise(function (res) {
      var t0 = Date.now();
      (function poll() { if (logoArt()) res(true); else if (Date.now() - t0 > 8000 || (LOGO && LOGO.state === 'missing')) res(false); else setTimeout(poll, 200); })();
    });
  }

  // ---------------------------------------------------------------- UI
  var form = $('rp-form'), statusEl = $('rp-status'), art = $('rp-art');
  function setStatus(msg, bad) { if (SAMPLE) return; statusEl.textContent = msg; statusEl.classList.toggle('rp-bad', !!bad); }
  var EMPTY_ART = art.innerHTML, EMPTY_STATUS = statusEl.textContent, EMPTY_CAP = $('rp-sample-txt').textContent;
  // The line under the frame: what is hanging there.
  function sampleLine(on) {
    $('rp-sample-line').hidden = !on;
    var t = EMPTY_CAP, ex = SHOW_EX && DATA && !BLOCKED;
    if (on) t = 'Sample: ' + SAMPLE.place + ', ' + SAMPLE.year + (ex ? ', with example words. Yours start blank.' : '.');
    else if (ex && META) t = (NEAR && ST.place === NEAR ? 'Your area, ' : '') + META.place + ', ' + META.year + ', with example words. Yours start blank.';
    else if (DATA && META && !BLOCKED) t = META.place + ', ' + META.year + (PREVIEW ? ', preview through ' + longDate(PREVIEW.last) : '') + '. ' + ($('rp-wall').getAttribute('data-view') === 'print' ? '13 x 19 print.' : '13 x 19, framed with a white mat.') +
      (NEAR && ST.place === NEAR ? ' Your area, near you. Not your town? Type it below.' : '');
    $('rp-sample-txt').textContent = t;
  }
  // Framed or print only: the same art, with or without the CSS frame. Step 3's pick sets it (setPick).
  function setView(v) {
    $('rp-wall').setAttribute('data-view', v);
    $('rp-strip').setAttribute('data-view', v);   // the phone's sticky thumbnail wears the same mat
    sampleLine(!!SAMPLE);
  }
  // After the reader's own draw, bring the frame into view if it is above the screen.
  function showArt() {
    var w = $('rp-wall');
    try { if (w.getBoundingClientRect().top < 0) w.scrollIntoView({ behavior: smooth(), block: 'start' }); } catch (e) {}
  }
  // Back to the page as it loads with no design: the empty box and the first instruction.
  function clearSample() {
    if (!SAMPLE) return;
    SAMPLE = null;
    DATA = null; PREVIEW = null; SETTLE = false; NOART = ''; BLOCKED = '';
    sampleLine(false);
    art.innerHTML = EMPTY_ART;
    art.classList.add('rp-empty');
    $('rp-stats-wrap').hidden = true;
    $('rp-source').textContent = '';
    $('rp-code-wrap').hidden = true;
    $('ro-design').value = '';
    setStatus(EMPTY_STATUS);
    showBuy(false);
  }
  function lastFullYear() { return CURRENT_YEAR - 1; }
  /* THE READER'S OWN AREA (2026-10-13, Sig): a new visitor's first print is
     their own town, last full year, from the subs worker's GET /where (the
     town Cloudflare puts on the request: no prompt, nothing kept). It is a
     real draw, the town in the box, ready to order. Outside the US, no
     answer in WHERE_MS, or any failure: the Chetek sample, as before. */
  var NEAR = '', WHERE_MS = 2500;
  function startNear() {
    // the reader typed a town and pressed Draw while this was waiting: theirs wins
    var mine = function () { return DATA || DRAWING || $('rp-place').value.trim(); };
    var done = false, fall = function () { if (!done) { done = true; if (!mine()) runSample(); } };
    // the example print in the page's HTML (a real NOAA year) stays up until a live draw replaces it
    if (!art.querySelector('.rp-ex')) art.innerHTML = '<p class="rp-placeholder">Drawing a year of rain near you\u2026</p>';
    setTimeout(fall, WHERE_MS);
    try {
      fetch('https://agsist-subs.dnilgis.workers.dev/where', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (j) {
        if (done) return;
        var town = j && j.ok && j.city && /^[A-Z]{2}$/.test(j.region_code || '') ? cleanText(j.city + ', ' + j.region_code, LIMITS.place) : '';
        if (!town || mine()) return fall();
        done = true;
        NEAR = town;
        $('rp-place').value = town;
        ga('rain_print_near', { state: j.region_code });
        run();
      }).catch(fall);
    } catch (e) { fall(); }
  }
  // the reader's dates moved onto the sample's year, so they show on it
  function sampleWords(w) { w.markers = w.markers.map(function (m) { return { date: SAMPLE.year + '-' + m.date.slice(5), label: m.label }; }); return w; }
  function runSample() {
    SAMPLE = { place: 'Chetek, WI', year: lastFullYear() };
    if (!art.querySelector('.rp-ex')) art.innerHTML = '<p class="rp-placeholder">Drawing a sample from NOAA records…</p>';
    var s = { place: SAMPLE.place, year: SAMPLE.year, size: '12x18', cmp: 'normal', name: '', markers: [], style: pick('rp-style', 'r1') };
    // the sample wears whatever is in the boxes: the example at first, then the reader's own words
    var w = sampleWords(readInputs()); s.name = w.name; s.dedication = w.dedication; s.markers = w.markers; s.cmp = w.cmp; s.normals = w.normals; s.records = w.records;
    s.logo = w.logo; s.logoInk = w.logoInk;
    run(null, normalize(s));
  }
  function useSample() {
    if (!SAMPLE || !DATA) return;
    SAMPLE = null; SHOW_EX = false;
    render();
    sampleLine(false);
    writeInputs(ST);
    setDesignRefs();
    showBuy(true);
    sampleLine(false);
    setStatus('This print is yours to change now: ' + ST.place + ', ' + ST.year + '. Change what you like, or order it below.');
  }
  function radios(name) { return Array.prototype.slice.call(doc.querySelectorAll('input[name="' + name + '"]')); }
  function pick(n, dflt) { var r = radios(n).find(function (x) { return x.checked; }); return r ? r.value : dflt; }
  /* A marked day is a month and a day picked from two lists; the year is the
     print's own (2026-10-14: a date typed with its year, 05022025, landed on
     the 25th in Chrome and Edge, because the date box's min and max locked its
     year). rowDate(i, y): 'YYYY-MM-DD', or '' until both are picked. */
  // the marked-day rows on the page: 1 to LIMITS.markers
  function dayNums() { var a = []; for (var i = 1; i <= LIMITS.markers; i++) a.push(i); return a; }
  var MAX_WORDS = LIMITS.markers + ' days is the most that fits. Remove one to mark another.';
  function rowDate(i, y) {
    var mo = $('rp-m' + i + 'mo').value, dy = $('rp-m' + i + 'dy').value;
    y = y || parseInt($('rp-year').value, 10);
    return y && mo && dy ? y + '-' + mo + '-' + dy : '';
  }
  function readInputs(year) {
    var markers = [], y = year || parseInt($('rp-year').value, 10);
    for (var i = 1; i <= LIMITS.markers; i++) {
      var d = rowDate(i, y), l = $('rp-m' + i + 'l').value;
      if (d) markers.push({ date: d, label: l });
    }
    // layout and palette are not on the page any more; they ride along so an old link keeps its code
    return normalize({ place: $('rp-place').value, year: y, station: ST.station,
      layout: ST.layout, palette: ST.palette, size: '12x18', style: pick('rp-style', 'r1'),
      cmp: $('rp-cmp').value, name: $('rp-name').value, dedication: $('rp-ded').value, markers: markers,
      normals: $('rp-normals').checked, records: $('rp-records').checked,
      crop: $('rp-crop').value, cropPlant: $('rp-crop-plant').value, cropHarvest: $('rp-crop-harvest').value, plants: $('rp-plants').checked, ghost: $('rp-ghost').checked,
      hist: $('rp-hist').checked, frost: $('rp-frost').checked, heat: $('rp-heat').checked, ribbon: $('rp-ribbon').checked,
      // the logo is not a box: its id rides along from the design, the color switch is read
      logo: ST.logo, logoInk: pick('rp-logo-ink', ST.logoInk ? '1' : '0') !== '0',
      // units and language: the reader's own switch (a Canadian design only; a US town drops them)
      units: isCanada($('rp-place').value) || isCanada(ST.station) ? ST.units : '', lang: isCanada($('rp-place').value) || isCanada(ST.station) ? ST.lang : '' });
  }
  // The year list: this year first (a gift, delivered in January), then every finished year.
  function giftYearLabel() { return fill((PRICES && PRICES.gift_year_label) || '{year} (ships January {next})'); }
  function buildYears() {
    var h = '<option value="' + CURRENT_YEAR + '">' + esc(giftYearLabel()) + '</option>';
    for (var y = CURRENT_YEAR - 1; y >= 1890; y--) h += '<option value="' + y + '">' + y + '</option>';
    $('rp-year').innerHTML = h;
  }
  function writeInputs(s) {
    $('rp-place').value = s.place;
    var yr = s.year || (CURRENT_YEAR - 1), sel = $('rp-year');
    // a year from a link that is not in the list (next year, or before 1890) still shows, so its message can explain
    if (!sel.querySelector('option[value="' + yr + '"]')) { var o = doc.createElement('option'); o.value = yr; o.textContent = yr; sel.insertBefore(o, sel.firstChild); }
    sel.value = String(yr);
    radios('rp-style').forEach(function (r) { r.checked = r.value === s.style; });
    $('rp-cmp').value = s.cmp;
    $('rp-name').value = s.name;
    $('rp-ded').value = s.dedication;
    $('rp-normals').checked = s.normals;
    $('rp-records').checked = s.records;
    $('rp-crop').value = s.crop; $('rp-plants').checked = s.plants; $('rp-ghost').checked = s.ghost;
    $('rp-hist').checked = s.hist; $('rp-frost').checked = s.frost; $('rp-heat').checked = s.heat; $('rp-ribbon').checked = s.ribbon;
    for (var i = 1; i <= LIMITS.markers; i++) {
      var m = s.markers[i - 1];
      $('rp-m' + i + 'mo').value = m ? m.date.slice(5, 7) : '';
      syncDayList(i, s.year);
      $('rp-m' + i + 'dy').value = m ? m.date.slice(8, 10) : '';
      $('rp-m' + i + 'l').value = m ? m.label : '';
    }
    syncRows();
    syncYearNote();
    // a design that uses the folded options opens them, so nothing on the print is out of sight
    if (s.records || s.logo || s.cmp === 'station' || (s.cmp === 'none' && s.normals) || s.crop || s.hist || s.ribbon) $('rp-more').open = true;
    if (s === ST) syncCropDays();
    radios('rp-logo-ink').forEach(function (r) { r.checked = r.value === (s.logoInk ? '1' : '0'); });
    if (s === ST) wantLogo();
    if ($('rp-name-n')) { syncCounts(); syncDates(); }
  }
  /* Counters under the name and the line ("12 of 24 letters"), emoji and
     symbols taken out as typed, with a note. maxlength stops typing at the
     limit; the counter says so. */
  var SYM_SEEN = false;
  function cleanField(id) {
    var el = $(id), v = el.value;
    if (hasUnprintable(v)) {
      var pos = el.selectionStart, nv = printable(v);
      el.value = nv;
      try { el.setSelectionRange(Math.max(0, pos - (v.length - nv.length)), Math.max(0, pos - (v.length - nv.length))); } catch (e) {}
      SYM_SEEN = true;
    }
    $('rp-sym-note').hidden = !SYM_SEEN;
    syncCounts();
  }
  /* field id -> {label, full}: a label that was cut to fit, while it still reads that way */
  var LABEL_CUT = {};
  /* Pasted past a box's limit (the boxes take only what fits, maxlength):
     the paste as it was, so the counter and the review sheet say what was cut
     instead of cutting it silently (2026-10-15). TEXT_CUT: the name and the
     line under it; a label's goes in LABEL_CUT, beside a link's. */
  var TEXT_CUT = {};
  function catchPaste(el) {
    el.addEventListener('paste', function (e) {
      var t = '';
      try { t = (e.clipboardData || root.clipboardData).getData('text'); } catch (err) { t = ''; }
      if (!t) return;
      var v = el.value, a = el.selectionStart || 0, b = el.selectionEnd || a;
      var full = cleanText(printable(v.slice(0, a) + t + v.slice(b)), 400), max = +el.getAttribute('maxlength') || 0;
      if (!max || full.length <= max) return;
      setTimeout(function () {
        if (/^rp-m\dl$/.test(el.id)) LABEL_CUT[el.id] = { label: el.value, full: full, pasted: true };
        else TEXT_CUT[el.id] = { kept: el.value, full: full };
        syncCounts(); restyle(); syncDates();
        if ($('rp-proof').open) proofRender();
      }, 0);
    });
  }
  function textCut(id) { var c = TEXT_CUT[id]; if (c && $(id).value !== c.kept) { delete TEXT_CUT[id]; c = null; } return c; }
  function cutWords(id, lim) { var c = textCut(id); return c ? ' (cut off: only ' + lim + ' letters fit, you typed \u201c' + c.full + '\u201d)' : ''; }
  var CUT_WORDS = 'That\u2019s ' + LIMITS.label + ' letters, the most that fits. Try a shorter word: Anniversary, Our 25th, Retired.';
  // the words typed in day i, whole, when they run past what the print takes
  function typedFull(i) { var f = $('rp-m' + i + 'l'); return f ? cleanText(printable(f.value), 200) : ''; }
  function typedOver(i) { return typedFull(i).length > LIMITS.label; }
  // a marked day whose typed words were cut to fit: the words as typed, for the review sheet
  function typedCut(m) {
    for (var i = 1; i <= LIMITS.markers; i++) {
      // pasted past the 13 letters the box takes (maxlength): the paste, whole
      var pc = LABEL_CUT['rp-m' + i + 'l'];
      if (pc && pc.pasted && rowDate(i, ST.year) === m.date && pc.label === m.label) return pc.full;
      var full = typedFull(i);
      if (full.length > LIMITS.label && rowDate(i, ST.year) === m.date && cleanText(full, LIMITS.label) === m.label) return full;
    }
    return null;
  }
  function syncCounts() {
    [['rp-name', 'rp-name-n', LIMITS.name], ['rp-ded', 'rp-ded-n', LIMITS.dedication]].forEach(function (x) {
      var n = $(x[0]).value.length, el = $(x[1]), c = textCut(x[0]);
      el.textContent = c ? 'Only ' + x[2] + ' letters fit, so what you pasted is cut to \u201c' + c.kept + '\u201d.'
        : n >= x[2] ? n + ' of ' + x[2] + ' letters. That\u2019s the most that fits.' : n + ' of ' + x[2] + ' letters';
      el.classList.toggle('rp-at', !c && n >= x[2]);
      el.classList.toggle('rp-bad', !!c);
      // the counter shows only within 5 letters of the limit (2026-10-15, Sig: too much dead space)
      el.classList.toggle('rp-near', n >= x[2] - 5);
    });
    /* The same counter under each date's label (2026-10-14: a label stopped at
       13 letters with no word). Words pasted or linked past 13 letters say what
       was cut, until the label is changed. */
    for (var i = 1; i <= LIMITS.markers; i++) {
      var f = $('rp-m' + i + 'l'), el = $('rp-m' + i + 'l-n');
      if (!f || !el) continue;
      var n = f.value.length, cut = LABEL_CUT[f.id], over = !cut && typedOver(i);
      if (cut && f.value !== cut.label) { delete LABEL_CUT[f.id]; cut = null; over = typedOver(i); }
      /* Typing past 13 letters (panel 5, 2026-10-15: "Our anniversary" printed as
         "Our anniversa" with only a gray counter): the box takes the words, the
         print takes 13 letters, and this says so in red until they fit. */
      el.textContent = cut ? 'Only ' + LIMITS.label + ' letters fit, so \u201c' + cut.full + '\u201d is cut to \u201c' + cut.label + '\u201d. Try a shorter word.'
        : over ? CUT_WORDS
        : n >= LIMITS.label ? n + ' of ' + LIMITS.label + ' letters. That\u2019s the most that fits.' : n + ' of ' + LIMITS.label + ' letters';
      el.classList.toggle('rp-at', !cut && !over && n >= LIMITS.label);
      el.classList.toggle('rp-bad', !!cut || over);
      el.classList.toggle('rp-near', n >= LIMITS.label - 5);
      f.setAttribute('aria-invalid', String(!!cut || over));
    }
  }
  // a design from a link: its cut labels, by field (the proof flags them too)
  function markLinkCuts(cuts) {
    LINK_CUTS = cuts || [];
    for (var i = 1; i <= LIMITS.markers; i++) {
      var d = rowDate(i), l = $('rp-m' + i + 'l').value;
      LINK_CUTS.forEach(function (c) { if (c.date === d && c.label === l) LABEL_CUT['rp-m' + i + 'l'] = { label: c.label, full: c.full }; });
    }
    syncCounts();
  }
  var LINK_CUTS = [];
  function linkCut(m) { return LINK_CUTS.filter(function (c) { return c.date === m.date && c.label === m.label; })[0] || null; }
  /* Each day's own message under its row (panel 5, 2026-10-15). A day half
     picked says so once the reader leaves its row, or at Check it and pay,
     never while they type; a day that isn't in the month says so at once,
     in words ("February has 28 days in 2025"). Under a finished day, the
     line it puts on the print: "On the print: Planted corn, May 21". */
  var TOUCHED = {};
  function rowWords(i) { return cleanText(printable($('rp-m' + i + 'l').value), LIMITS.label); }
  function onPrintLine(i, y) {
    var d = rowDate(i, y || parseInt($('rp-year').value, 10)), yy = parseInt(d, 10), w = rowWords(i);
    if (!d || dayIndex(yy, d) < 0) return '';
    // this year's gift: a day past the preview isn't drawn yet, and it is on the print made in January (2026-10-15)
    if (PREVIEW && ST.gift && yy === ST.year && d > PREVIEW.last) return 'On the January print: ' + (w ? w + ', ' : '') + shortDate(d) + '. The preview stops at ' + shortDate(PREVIEW.last) + '.';
    if (FR()) { var pf = d.split('-').map(Number); return 'Sur le tirage : ' + (w ? w + ', ' : '') + (pf[2] === 1 ? '1er' : pf[2]) + ' ' + (root.AgRainArt ? root.AgRainArt.MON_FR[pf[1] - 1] : MON3[pf[1] - 1]); }
    return 'On the print: ' + (w ? w + ', ' : '') + shortDate(d);
  }
  function rowProblems() {
    var y = parseInt($('rp-year').value, 10), ds = dayNums().map(function (i) { return rowDate(i, y); });
    var probs = dateProblems(y, ds), out = {};
    dayNums().forEach(function (i) { out[i] = []; });
    probs.forEach(function (p) { out[p.i + 1].push(p); });
    dayNums().forEach(function (i) {
      var mo = $('rp-m' + i + 'mo').value, dy = $('rp-m' + i + 'dy').value, l = $('rp-m' + i + 'l').value.trim();
      if ((mo || dy || l) && !(mo && dy)) out[i].unshift({ kind: 'half', mo: !mo, dy: !dy, msg: 'Day ' + i + (l ? ' (\u201c' + rowWords(i) + '\u201d)' : '') + ' needs a month and a day to go on the print.' });
    });
    return out;
  }
  // the first day that can't go on the print as it is (a half-picked day, or no such day), or 0
  function badRow() {
    var P = rowProblems();
    for (var i = 1; i <= LIMITS.markers; i++) if (!$('rp-m' + i + 'row').hidden && (P[i].some(function (p) { return p.kind !== 'same'; }) || UNPLACED.indexOf(i) >= 0)) return i;
    return 0;
  }
  function syncDates() {
    var P = rowProblems();
    dayNums().forEach(function (i) {
      var show = P[i].filter(function (p) { return p.kind !== 'half' || TOUCHED[i]; });
      var moBad = show.some(function (p) { return (p.kind === 'half' && p.mo) || p.kind === 'year'; });
      var dyBad = show.some(function (p) { return (p.kind === 'half' && p.dy) || p.kind === 'day' || p.kind === 'year'; });
      $('rp-m' + i + 'mo').setAttribute('aria-invalid', String(moBad)); $('rp-m' + i + 'dy').setAttribute('aria-invalid', String(dyBad));
      var err = $('rp-m' + i + 'err');
      err.textContent = show.map(function (p) { return p.msg; }).join(' ');
      err.hidden = !show.length;
      // under a finished day, what it puts on the print; a day the art had no clean room for says so instead
      var on = $('rp-m' + i + 'on'), line = P[i].some(function (p) { return p.kind !== 'same'; }) ? '' : onPrintLine(i), off = !!line && UNPLACED.indexOf(i) >= 0;
      if (off) line = unplacedWords(i);
      on.textContent = line; on.hidden = !line; on.classList.toggle('rp-bad', off);
    });
    syncRows();
  }
  // the phone's pinned strip says the line for a moment after a change: the print in it is too small to read
  var STRIP_T = null;
  function stripSay(i) {
    var el = $('rp-strip-say'), line = onPrintLine(i);
    if (!el) return;
    if (!line) { el.hidden = true; return; }   // a day not finished (or no such day) says nothing up there
    el.textContent = line; el.hidden = false;
    if (STRIP_T) clearTimeout(STRIP_T);
    STRIP_T = setTimeout(function () { el.hidden = true; }, 4000);
  }
  function dateSay(t) { var el = $('rp-date-say'); if (el) el.textContent = t || ''; }
  // the month lists, once; each day list runs to that month's length in the print's year
  function daysIn(y, mo) { return mo ? new Date(Date.UTC(y || 2001, +mo, 0)).getUTCDate() : 31; }
  function buildDayLists() {
    for (var i = 1; i <= LIMITS.markers; i++) {
      $('rp-m' + i + 'mo').innerHTML = '<option value="">Month</option>' + MON.map(function (m, k) { return '<option value="' + String(k + 1).padStart(2, '0') + '">' + m + '</option>'; }).join('');
      syncDayList(i);
    }
  }
  function syncDayList(i, year) {
    var y = year || parseInt($('rp-year').value, 10), sel = $('rp-m' + i + 'dy'), was = sel.value, n = daysIn(y, $('rp-m' + i + 'mo').value), h = '<option value="">Day</option>';
    for (var d = 1; d <= n; d++) h += '<option value="' + String(d).padStart(2, '0') + '">' + d + '</option>';
    // Feb 29 kept when the year changes to one without it, so the note under the days can say so
    if (was && +was > n) h += '<option value="' + was + '">' + (+was) + '</option>';
    sel.innerHTML = h;
    sel.value = was;
  }
  function syncDayLists() { for (var i = 1; i <= LIMITS.markers; i++) syncDayList(i); }
  // "Mark a day": one row to start; a row in use always shows; "+ Mark another day" opens the next, up to LIMITS.markers (5)
  function rowUsed(i) { return !!($('rp-m' + i + 'mo').value || $('rp-m' + i + 'dy').value || $('rp-m' + i + 'l').value); }
  function rowsShown() { var shown = 1; for (var i = 2; i <= LIMITS.markers; i++) if (!$('rp-m' + i + 'row').hidden) shown = i; return shown; }
  function syncRows() {
    for (var i = 2; i <= LIMITS.markers; i++) if (rowUsed(i)) $('rp-m' + i + 'row').hidden = false;
    var shown = rowsShown(), full = shown >= LIMITS.markers;
    $('rp-add-day').hidden = full;
    $('rp-dates-max').hidden = !full;
    // a lone empty first day has nothing to remove
    $('rp-m1rm').hidden = shown === 1 && !rowUsed(1);
    // the label ideas fill the first empty label: with every day labeled there is nowhere to put one
    var none = dayNums().every(function (i) { return !!$('rp-m' + i + 'l').value; });
    doc.querySelectorAll('#rp-presets button').forEach(function (b) { b.setAttribute('aria-disabled', String(none)); });
  }
  function addDay() {
    for (var i = 2; i <= LIMITS.markers; i++) {
      var row = $('rp-m' + i + 'row');
      if (row.hidden) { row.hidden = false; syncRows(); try { $('rp-m' + i + 'mo').focus(); } catch (e) {} return i; }
    }
    return 0;
  }
  function setRow(i, mo, dy, l) {
    $('rp-m' + i + 'mo').value = mo; syncDayList(i); $('rp-m' + i + 'dy').value = dy; $('rp-m' + i + 'l').value = l;
  }
  /* Remove day i: the days after it move up (so the rows stay Day 1, 2, 3 in
     order), the last row closes, and focus goes to "+ Mark another day". */
  function removeDay(i) {
    endExample();
    var shown = rowsShown();
    for (var j = i; j < shown; j++) {
      setRow(j, $('rp-m' + (j + 1) + 'mo').value, $('rp-m' + (j + 1) + 'dy').value, $('rp-m' + (j + 1) + 'l').value);
      TOUCHED[j] = TOUCHED[j + 1];
      var c = LABEL_CUT['rp-m' + (j + 1) + 'l']; if (c) LABEL_CUT['rp-m' + j + 'l'] = c; else delete LABEL_CUT['rp-m' + j + 'l'];
    }
    setRow(shown, '', '', ''); TOUCHED[shown] = false; delete LABEL_CUT['rp-m' + shown + 'l'];
    if (shown > 1) $('rp-m' + shown + 'row').hidden = true;
    syncCounts(); syncDates(); restyle();
    dateSay('Day ' + i + ' removed.');
    try { $('rp-add-day').focus(); } catch (e) {}
  }
  // this year picked: one line under the Year box, the moment it is picked
  function syncYearNote() {
    var y = parseInt($('rp-year').value, 10), el = $('rp-year-note');
    if (!el) return;
    el.textContent = y === CURRENT_YEAR ? CURRENT_YEAR + ' isn\u2019t over yet. Order it now and I email you a gift card to print within 1 business day; the print ships in January.' : '';
    el.hidden = !el.textContent;
  }
  var KEEP_URL = false;   // a ?d=RPS- link that didn't open stays in the address bar until the reader draws
  /* The address follows the design, a moment after the typing stops (400 ms),
     never once per letter: Safari refuses past 100 replaceState calls in 30
     seconds (2026-10-15). updateUrlNow writes it at once (checkout, leaving). */
  var URL_T = 0, URL_LOG = [], URL_LAZY = false;
  function updateUrl() {
    // a draw writes it at once; typing (URL_LAZY, the redraw after a pause) waits for the pause
    if (!URL_LAZY && !URL_T) { updateUrlNow(); return; }
    clearTimeout(URL_T);
    URL_T = setTimeout(updateUrlNow, 400);
  }
  function updateUrlNow() {
    clearTimeout(URL_T); URL_T = 0;
    if (SAMPLE || KEEP_URL) return;   // a sample never goes into the address bar
    var now = Date.now();
    URL_LOG = URL_LOG.filter(function (t) { return now - t < 30000; });
    if (URL_LOG.length >= 60) { URL_T = setTimeout(updateUrlNow, 30000 - (now - URL_LOG[0]) + 50); return; }
    URL_LOG.push(now);
    var q = toParams(ST) + (MAKER ? '&maker=1' + (SERIAL ? '&serial=' + SERIAL.replace(/\D/g, '') : '') : '') +
      // the product picked, so Back and a reload keep it (framed, the default, stays out of the address)
      (PICK && PICK !== 'framed12x18' ? '&pick=' + PICK : '');
    var to = root.location.pathname + '?' + q;
    if (root.location.pathname + root.location.search === to) return;
    try { root.history.replaceState(null, '', to); } catch (e) {}
  }

  function showBuy(on) {
    on = on && !SAMPLE;
    // Before anything of the reader's is drawn the buttons stay live and point at the town box; a station with too many gaps turns them off.
    var lost = loadFail();
    var off = !!BLOCKED || DRAWING || !!lost;
    $('rp-buy').classList.toggle('rp-off', off);
    $('rp-pay').disabled = off; $('rp-bar-go').disabled = off;
    // why the buttons are off, in words, by the buttons
    var why = $('rp-buy-why');
    if (why) {
      why.textContent = DRAWING ? 'Drawing your print. Ordering opens when it is done.'
        : BLOCKED === 'failed' ? 'Ordering is off until your print draws. See the message by the town box above.'
        : BLOCKED ? 'Ordering is off: this station is missing too many days for a fair print. Pick another station or year above.'
        : lost ? 'Ordering is off: ' + lost.charAt(0).toLowerCase() + lost.slice(1) + ' Press Draw again.' : '';
      why.hidden = !why.textContent;
    }
    $('rp-dl').disabled = !on || !DATA;
    $('rp-zoom').disabled = !DATA || !!BLOCKED;
    $('rp-wall').classList.toggle('rp-can-zoom', !!DATA && !BLOCKED);
    // print files wait for the full year: a preview is never sent to the printer
    doc.querySelectorAll('#rp-maker button').forEach(function (b) { b.disabled = !on || !DATA || !!PREVIEW || SETTLE; });
    syncGift();
    if (typeof GIFT !== 'undefined' && GIFT) syncGiftUse();
    syncPending(); syncBar(); syncStrip();
  }

  // ---------- this year, as a gift ----------
  var GIFT_MSG_MAX = 240, GIFT_TO_MAX = 80;
  function fill(t) { return String(t || '').replace(/\{year\}/g, String(CURRENT_YEAR)).replace(/\{next\}/g, String(CURRENT_YEAR + 1)); }
  function giftMode() { return !!ST.year && yearMode(ST.year, TODAY) === 'gift'; }
  function canOrder() { return !SAMPLE && !BLOCKED && !DRAWING && (!!DATA || !!NOART); }
  var ORDER_NOTE = '';
  function syncGift() {
    var on = giftMode() && canOrder();
    $('rp-gift').hidden = !on;
    /* Who it's for and the card note are asked here, on the page, always
       (2026-10-18, Sig: the page must not rely on Stripe for gift details).
       With a checkout link they come onto the review sheet's gift box
       (#rp-pgift) and go to Sig as a rain-print-order post before checkout. */
    $('rp-gift-fields').hidden = false;
    $('rp-gift-cardnote').textContent = 'Want a gift card for under the tree? Fill in the boxes above, then order. Within 1 business day of paying, I email you a card to print, with a code they use to see their print.';
    // the digital file's card (2026-10-14, Sig: no proof step for the file; he redoes it free on request)
    $('rp-dig-when').textContent = on ? 'The finished file by email in January, once the full year is in'
      : SETTLE && canOrder() ? 'The finished file by email once the full year is in' : 'The finished file by email within 1 business day of paying';
    if (!ORDER_NOTE) ORDER_NOTE = $('ro-order-note').textContent;
    $('ro-order-note').textContent = GIFT && GIFT.usable ? 'Your gift card covers this print, so there\u2019s nothing to pay. Check the design below, then send it.'
      : on ? 'I\u2019ll email you within 1 business day with a payment link. Nothing\u2019s charged until you pay it. In January, once the full year is in, I send the proof of a print, or the finished file.' : ORDER_NOTE;
    $('rp-preview-line').hidden = !(on && PREVIEW);
    syncAddress();
    syncCutoffs();
    syncXmas();
    syncPick();
  }
  /* Each choice in the picker says when it comes: the Christmas order-by date
     for a print or framed (a plain date from data/rain-print.json), the file
     by email. This year's gift and a year NOAA hasn't finished say so instead. */
  var CUTOFF_KEY = { print12x18: 'print_christmas_cutoff', framed12x18: 'framed_christmas_cutoff' };
  var SUB_BASE = { framed12x18: 'Black frame, white mat, real glass.', print12x18: '13 x 19 paper, ships flat.' };
  function syncCutoffs() {
    var gift = giftMode() && canOrder(), settle = SETTLE && canOrder();
    PRODUCTS.forEach(function (id) {
      var el = $('rp-sub-' + id);
      if (!el) return;
      el.textContent = id === 'digital'
        ? (gift ? 'A gift card to print by email within 1 business day. The file comes in January, once the full year is in.'
          : settle ? 'A PNG and a PDF by email once the full year is in.' : 'A PNG and a PDF by email within 1 business day of paying.')
        : (SUB_BASE[id] + ' ' + (gift ? 'A gift card to print by email within 1 business day; the ' + (id === 'framed12x18' ? 'framed print' : 'print') + ' ships in January.'
          : settle ? 'Made once NOAA has all of ' + ST.year + ' in, with a proof first.' : cutoffNote(TODAY, OJ().j && OJ().j[CUTOFF_KEY[id]]))).trim();
      if (blockedPick(id)) el.textContent = L('Shipping to Canada starts soon.', 'Envoi au Canada bientôt.');
    });
  }

  /* The Christmas line at the top and the line under step 3: the order-by
     dates from data/rain-print.json, and what they allow for. October 1
     through December 25 only. */
  function syncXmas() {
    var J = OJ().j || {}, pc = J.print_christmas_cutoff, fc = J.framed_christmas_cutoff;
    // no dates (a Canadian design: no Christmas promise unless data/rain-print.json canada sets one): no Christmas lines
    $('rp-xmas-alt').hidden = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pc || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fc || '')) { $('rp-xmas-top').hidden = true; $('rp-xmas-why').hidden = true; return; }
    var top = $('rp-xmas-top'), why = $('rp-xmas-why'), late = TODAY > pc && TODAY > fc;
    if (TODAY > pc.slice(0, 4) + '-12-25' || TODAY < pc.slice(0, 4) + '-10-01') { top.hidden = true; return; }
    // one product past its date and the other not: say which (2026-10-14, panel 3)
    var lateMail = ' Too late for the mail? The digital file comes by email in 1 business day, or give the gift card now and the print after Christmas.';
    var gift = giftMode() && canOrder(), ly = CURRENT_YEAR - 1;
    /* "Last year, by Christmas" beside "This year, in January" (2026-10-19, board B: a county link opened this
       year's print and nobody said last year still comes by Christmas). While a cutoff is ahead the first screen
       names both; a drawn design of this year gets one tap to last year. After the cutoffs, the words as before. */
    var by = TODAY <= pc && TODAY <= fc ? 'framed by ' + shortDate(fc) + ', or as a print by ' + shortDate(pc)
      : TODAY <= pc ? 'as a print by ' + shortDate(pc) + ' (framed now ships after Christmas)'
      : 'framed by ' + shortDate(fc) + ' (a print now ships after Christmas)';
    var thisYr = 'This year (' + CURRENT_YEAR + ') is a gift card now, the print in January.';
    top.textContent = late ? (gift ? 'For Christmas: a gift card now, the print in January.' : 'For Christmas: past years ordered now ship after Christmas.' + lateMail)
      : gift ? 'For Christmas: ' + thisYr.charAt(0).toLowerCase() + thisYr.slice(1) + ' Last year (' + ly + ') comes by Christmas if you order it ' + by + '.'
      : 'For Christmas: last year (' + ly + '), or any past year, comes by Christmas if you order it ' + by + '. ' + thisYr;
    top.hidden = false;
    if (!late && gift && ST.place && !(GIFT && GIFT.lock)) {
      $('rp-xmas-last').textContent = 'Make it ' + ly + ', by Christmas';
      $('rp-xmas-alt').hidden = false;
    }
    if (Number.isInteger(J.ship_business_days) && J.transit_business_days) {
      why.textContent = 'The Christmas dates allow ' + (J.proof_business_days === 1 ? 'a business day' : J.proof_business_days + ' business days') + ' for the proof, ' +
        (J.approve_business_days === 1 ? 'one' : J.approve_business_days) + ' for you to OK it, ' + J.ship_business_days + ' to ship and the time in the mail, to arrive by Dec 24.';
      // this year's gift ships in January: the Christmas dates aren't about it
      why.hidden = late || (giftMode() && canOrder()) || PICK === 'digital';
    }
  }
  // "<b>Cameron, WI (2 mi NE of Cameron)</b>, 3.1 mi from Chetek (NOAA co-op station 471667)"
  // and, when the pick traded miles for a snowfall record (or looked and found none): "Picked over a gauge 1.9 mi away because it records snowfall too."
  function gaugeHtml(m) {
    var w = pickWhy(m.why, m.year);
    if (m.ca && CA()) {
      var lg = LOC().lang, fr = lg === 'fr';
      w = !m.why ? '' : m.why.over ? (fr ? 'Choisie plutôt qu’une station à ' : 'Picked over a station ') + CA().kmText(m.why.over.km, lg) + (fr ? ' parce qu’elle mesure aussi la neige.' : ' away because it records snowfall too.')
        : m.why.none ? (fr ? 'Aucune station à proximité n’a de relevés de neige complets pour ' : 'No station nearby kept a full snowfall record for ') + m.year + (fr ? ', donc le tirage ne montre pas de neige.' : ', so the print draws no snow.') : '';
      var dist = m.approx ? caWords().near + ' ' + m.city : CA().kmText(m.km, lg) + ' ' + caWords().from + ' ' + m.city;
      return '<b>' + esc(m.name + (m.state ? ', ' + m.state : '')) + '</b>, ' + esc(dist) + ' (' + esc(sidPlain(m.sid, lg)) + ')' + (w ? '. <span class="rp-why" id="rp-why">' + esc(w.replace(/\.$/, '')) + '</span>' : '') +
        (STATIONS.length > 1 ? (w ? '.' : '') + ' <a href="#rp-station" class="rp-chg" id="rp-chg">' + L('Change station', 'Changer de station') + '</a>' : '');
    }
    return '<b>' + esc(gaugeWords(m)) + '</b>, ' + esc(distText(m)) + ' (' + esc(sidPlain(m.sid)) + ')' + (w ? '. <span class="rp-why" id="rp-why">' + esc(w.replace(/\.$/, '')) + '</span>' : '') +
      (STATIONS.length > 1 ? (w ? '.' : '') + ' <a href="#rp-station" class="rp-chg" id="rp-chg">Change station</a>' : '');
  }
  /* The credit a Canadian print carries on the page (ECCC Data Servers End-use Licence, section 3). */
  function caCredit() {
    var fr = FR(), src = META && META.src, w = caWords();
    return esc(w.source(src)) + ' (<a href="' + (fr ? CA().LICENCE_URL_FR : CA().LICENCE_URL) + '" rel="noopener">' + (fr ? 'licence' : 'licence') + '</a>)' +
      (META && META.postal ? L('. Postal areas: GeoNames (CC BY 4.0)', '. Codes postaux : GeoNames (CC BY 4.0)') : '') + '.';
  }
  function usualWords() {
    if (META && META.ca) {
      if (ST.cmp === 'normal') { var u = caUsual(META.sid); return u ? u + L(', counted only on the days the station reported.', ', comptée seulement les jours où la station a fait un relevé.') : ''; }
      if (ST.cmp === 'station' && EXT) return L('A usual year here means this station\u2019s own average, ', 'Ici, une année normale est la moyenne de cette station, ') + EXT.yearFrom + L(' to ', ' à ') + EXT.yearTo + L(', counted only on the days it reported.', ', comptée seulement les jours où elle a fait un relevé.');
      return '';
    }
    if (ST.cmp === 'normal') return NORM30 || NORM_WAIT ? 'A usual year here means NOAA\u2019s 30-year normal for this station, counted only on the days it reported.' : '';
    if (ST.cmp === 'station' && EXT) return 'A usual year here means this station\u2019s own average, ' + EXT.yearFrom + ' to ' + EXT.yearTo + ', counted only on the days it reported.';
    return '';
  }
  function setDesignRefs() {
    if (SAMPLE) { $('rp-code-wrap').hidden = true; $('ro-design').value = ''; return; }
    var code = encodeCode(ST);
    $('rp-code').textContent = code;
    // the code itself shows in the note once checkout opens; a 100-letter code under the prices only puzzles (2026-10-13)
    $('rp-code-wrap').hidden = true;
    $('ro-design').value = designUrl(ST);
    updateUrl();
  }
  /* This year, too thin to draw: a plain message instead of art. The order stays
     open; Sig draws the print from the full year in January. */
  function renderNoArt() {
    var m = META;
    art.innerHTML = '<p class="rp-placeholder">' + esc(NOART) + '</p>';
    art.classList.add('rp-empty');
    $('rp-stats-wrap').hidden = true;
    $('rp-source').innerHTML = (m.ca ? L('The print will come from this weather station: ', 'Le tirage viendra de cette station météo : ') : 'The print will come from this weather station: ') + gaugeHtml(m) +
      (m.ca ? '. ' + caCredit() : '. Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>.');
    setDesignRefs();
    showBuy(true);
  }

  /* A Canadian print's line under the art and its year in numbers, in its units and
     language (the same facts as the US lines above them, said the same way). */
  function caText(D, m, OV, later) {
    var fr = FR(), mm = LOC().units === 'mm';
    var nf = function (v, d) { var t = (+v).toFixed(d); return fr ? t.replace('.', ',') : t; };
    var rain = function (inch, day) { return mm ? nf(inch * 25.4, day ? 1 : 0) + ' mm' : nf(inch, 2) + ' in'; };
    var snow = function (inch) { return mm ? nf(inch * 2.54, 0) + ' cm' : nf(inch, 1) + ' in'; };
    // the year's snowfall from the days themselves (as the print does), not from inches already rounded to a tenth
    var snowRaw = D.snow === null || D.snow === undefined ? null : DATA.days.reduce(function (t, x) { return x.v === null || x.v === undefined || !(x.s > 0) ? t : t + x.s; }, 0);
    var dayW = function (iso) { var p = String(iso).split('-').map(Number); return fr ? (p[2] === 1 ? '1er' : p[2]) + ' ' + ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][p[1] - 1] : longDate(iso); };
    var u = usualWords();
    if (PREVIEW) $('rp-preview-line').innerHTML = fr ? '<b>Aperçu jusqu’au ' + esc(dayW(PREVIEW.last)) + '.</b> Le tirage final montre toute l’année.' : '<b>Preview through ' + esc(longDate(PREVIEW.last)) + '.</b> The print you get shows the full year.';
    $('rp-source').innerHTML = esc(caWords().gauge) + (fr ? ' : ' : ': ') + gaugeHtml(m) + '. ' +
      (fr ? (D.n - D.missing) + ' jours sur ' + D.n + ' ont un relevé' + (PREVIEW ? ' jusqu’ici, du 1er janvier au ' + esc(dayW(PREVIEW.last)) : '') +
          (D.missing ? '; la station n’a rien envoyé pour ' + D.missing + (D.missing === 1 ? ' jour, laissé en blanc' : ' jours, laissés en blanc') + ', jamais dessinés comme secs' : '') + '. '
        : (D.n - D.missing) + ' of ' + D.n + ' days recorded' + (PREVIEW ? ' so far, January 1 through ' + esc(longDate(PREVIEW.last)) : '') +
          (D.missing ? '; the station sent no report on ' + D.missing + (D.missing === 1 ? ' day, left as a gap' : ' days, left as gaps') + ', not drawn as dry' : '') + '. ') +
      (D.unsplit ? (fr ? D.unsplit + (D.unsplit === 1 ? ' jour a été relevé' : ' jours ont été relevés') + ' avec un total plus tard; ce total est dessiné le jour du relevé. ' : D.unsplit + (D.unsplit === 1 ? ' day was' : ' days were') + ' reported together in a later total; that total is drawn on the day it was reported. ') : '') +
      (PREVIEW && OV ? L('The comparison covers the same days. ', 'La comparaison couvre les mêmes jours. ') : '') +
      (STUCK ? '<b>' + esc(m.name) + (fr ? ' a relevé 0 pendant ' + STUCK.n + ' jours de suite, quand cette période reçoit d’habitude ' + rain(STUCK.usual) + '. Le pluviomètre était peut-être bloqué, donc le tirage laisse de côté la période sèche et les journées remarquables.</b> '
        : ' reported 0 for ' + STUCK.n + ' days in a row, ' + esc(longDate(STUCK.from)) + ' to ' + esc(longDate(STUCK.to)) + ', when that stretch usually gets ' + rain(STUCK.usual) + '. The gauge may have been stuck, so the print leaves off the dry stretch and the remarkable days.</b> ') : '') +
      (later ? L((later === 1 ? 'Your date after ' : 'Your dates after ') + esc(longDate(PREVIEW.last)) + ' will be on the finished print. ', (later === 1 ? 'Votre date après le ' : 'Vos dates après le ') + esc(dayW(PREVIEW.last)) + ' seront sur le tirage final. ') : '') +
      (u ? esc(u) + ' ' : '') + caCredit() +
      (ST.records && PREVIEW ? L(' Remarkable days are marked once the year is over.', ' Les journées remarquables sont ajoutées une fois l’année finie.') : '') +
      (ST.records && !PREVIEW && root.AgRainRecords && !EXT_WAIT && !(EXT && EXT.rows) ? L(' The station history didn’t load, so the year and month records are left off.', ' L’historique de la station n’a pas chargé, donc les records de l’année et du mois sont laissés de côté.') : '') +
      (ST.records && SKIPPED.length ? L(' Left off the print for space: ', ' Laissé de côté faute de place : ') + esc(SKIPPED.join(', ')) + '.' : '') +
      (ST.cmp !== 'none' && !OV && !(EXT_WAIT && ST.cmp === 'station') && !(NORM_WAIT && ST.cmp === 'normal') ? ' <b>' + esc(ST.cmp === 'normal' ? caWords().noNormal : L('The station history didn’t load, so there’s no comparison line.', 'L’historique de la station n’a pas chargé, donc pas de ligne de comparaison.')) + '</b>' : '');
    var rows = fr ? [
      [PREVIEW ? 'Précipitations jusqu’ici' : 'Précipitations', rain(D.total) + ' (pluie et neige fondue)'],
      ['Neige', snowRaw !== null ? snow(snowRaw) : 'pas de relevés de neige complets à cette station'], ['Jours de pluie ou de neige', D.wet], ['Plus longue période sèche', D.dryMax.len + ' jours'],
      ['Journée la plus arrosée', D.max.v > 0 ? dayW(D.max.date) + ', ' + rain(D.max.v, true) : D.wet ? 'inconnue : un relevé de plusieurs jours pourrait en cacher une plus grosse' : 'pas de pluie mesurable'],
      ['Jours de traces', D.trace], ['Jours sans relevé', D.missing],
      ['Comparé avec', OV ? OV.label + ', ' + rain(OV.total) + (PREVIEW ? ' (mêmes jours)' : '') : 'rien']
    ] : [
      [PREVIEW ? 'Precipitation so far' : 'Precipitation', rain(D.total) + ' (rain and melted snow)'],
      ['Snowfall', snowRaw !== null ? snow(snowRaw) : 'no full snowfall record at this station'], ['Days with rain or snow', D.wet], ['Longest dry stretch', D.dryMax.len + ' days'],
      ['Wettest day', D.max.v > 0 ? fmtDate(D.max.date) + ', ' + rain(D.max.v, true) : D.wet ? 'not known: a report that covers several days could hold a bigger one' : 'no measurable rain'],
      ['Trace days', D.trace], ['Days with no report', D.missing],
      ['Compared with', OV ? OV.label + ', ' + rain(OV.total) + (PREVIEW ? ' (same days)' : '') : 'nothing']
    ];
    $('rp-stats').innerHTML = rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(String(r[1])) + '</dd></div>'; }).join('');
  }
  function render() {
    if (!DATA || BLOCKED) return;
    // the maker sees the serial on screen; nobody else ever does
    art.innerHTML = buildSvg({ serial: SERIAL, example: SHOW_EX });
    art.classList.remove('rp-empty');
    // each day's line under its row follows what the art could place
    if ($('rp-m1on')) syncDates();
    // the slim copy that pins under the menu on a phone is drawn when it shows (syncStrip)
    MINI_DIRTY = true;
    // a buy note about an earlier design no longer applies
    if (BUY_NOTE_CODE && BUY_NOTE_CODE !== encodeCode(ST)) { $('rp-buy-note').textContent = ''; BUY_NOTE_CODE = ''; }
    var D = DATA.d, m = META, OV = overlaySeries();
    var dist = distText(m);
    var later = PREVIEW ? ST.markers.filter(function (x) { return x.date > PREVIEW.last; }).length : 0;
    if (PREVIEW) $('rp-preview-line').innerHTML = '<b>Preview through ' + esc(longDate(PREVIEW.last)) + '.</b> The print you get shows the full year.';
    if (m.ca && CA()) caText(D, m, OV, later);
    else {
    $('rp-source').innerHTML = 'Weather station: ' + gaugeHtml(m) + '. ' +
      (D.n - D.missing) + ' of ' + D.n + ' days recorded' + (PREVIEW ? ' so far, January 1 through ' + esc(longDate(PREVIEW.last)) : '') + (D.missing ? '; the station sent no report on ' + D.missing + (D.missing === 1 ? ' day, left as a gap' : ' days, left as gaps') + ', not drawn as dry' : '') + '. ' +
      (D.unsplit ? D.unsplit + (D.unsplit === 1 ? ' day was' : ' days were') + ' reported together in a later total; that total is drawn on the day it was reported. ' : '') +
      (PREVIEW && OV ? 'The comparison covers the same days. ' : '') +
      (STUCK ? '<b>' + esc(stationName(m.name)) + ' reported 0.00 for ' + STUCK.n + ' days in a row, ' + esc(longDate(STUCK.from)) + ' to ' + esc(longDate(STUCK.to)) +
        ', when that stretch usually gets ' + f2(STUCK.usual) + ' in. The gauge may have been stuck, so the print leaves off the dry stretch and the remarkable days.</b> Pick another station under Weather station if there is one. ' : '') +
      (later ? (later === 1 ? 'Your date after ' : 'Your dates after ') + esc(longDate(PREVIEW.last)) + ' will be on the finished print. ' : '') +
      (PREVIEW && !ST.gift ? 'NOAA hasn\u2019t sent the rest of ' + ST.year + ' from this station yet; the print you get shows the full year. ' : '') +
      (usualWords() ? esc(usualWords()) + ' ' : '') +
      'Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>. ' +
      (ST.records && PREVIEW ? ' Remarkable days are marked once the year is over.' : '') +
      (ST.records && !PREVIEW && root.AgRainRecords && !EXT_WAIT && !(EXT && EXT.rows) ? ' The station history didn’t load, so the year and month records are left off.' + (LOAD_FAIL.has('por|' + m.sid) ? ' Press Draw again.' : '') : '') +
      (ST.records && SKIPPED.length ? ' Left off the print for space: ' + esc(SKIPPED.join(', ')) + '.' : '') +
      (ST.cmp !== 'none' && !OV && !(EXT_WAIT && ST.cmp === 'station') && !(NORM_WAIT && ST.cmp === 'normal') ? ' <b>' + (ST.cmp === 'normal' ? (LOAD_FAIL.has('norm|' + m.sid + '|' + ST.year) ? 'The usual-year line didn’t load. Press Draw again.' : 'This station has no NOAA normal, so there’s no comparison line.')
        : 'The station history didn’t load, so there’s no comparison line.' + (LOAD_FAIL.has('por|' + m.sid) ? ' Press Draw again.' : '')) + '</b>' : '');
    var rows = [
      [PREVIEW ? 'Precipitation so far' : 'Precipitation', f2(D.total) + ' in (rain and melted snow)'],
      ['Snowfall', D.snow !== null && D.snow !== undefined ? D.snow.toFixed(1) + ' in' : 'no full snowfall record at this station'], ['Days with rain or snow', D.wet], ['Longest dry stretch', D.dryMax.len + ' days'],
      ['Wettest day', D.max.v > 0 ? fmtDate(D.max.date) + ', ' + f2(D.max.v) + ' in' : D.wet ? 'not known: a report that covers several days could hold a bigger one' : 'no measurable rain'],
      ['Trace days', D.trace], ['Days with no report', D.missing],
      ['Compared with', OV ? OV.label + ', ' + f2(OV.total) + ' in' + (PREVIEW ? ' (same days)' : '') : 'nothing']
    ];
    $('rp-stats').innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(String(r[1])) + '</dd></div>'; }).join('');
    }
    $('rp-stats-wrap').hidden = false;
    syncCa();
    setDesignRefs();
    showBuy(true);
    sampleLine(!!SAMPLE);
    syncPaidHint();
    if (!$('rp-order').hidden) syncSummary();
    if ($('rp-proof').open) proofRender();
    syncStrip();
    syncExtrasUi();
  }

  /* EMAIL ME WHEN <YEAR> IS FINISHED (2026-10-19, board Bet 1). Once a print
     of this year (the year still going) is drawn for a US town whose county the
     town lookup named, one quiet card under Pay offers the county rain pages'
     own January notice: topic rainyear:<year>:<fips>, POST /notice (subs worker
     v5.28), mailed by scripts/send_rain_year.py, which adds one line for a
     Rain Print ask (source page:rain-print). components/signup-ask.js draws
     the form, as on the county pages. A past year, the sample, a Canadian
     town, a town with no county named, a county with no row in
     data/rain/<st>.json, a gift card being used and Sig's maker view ask
     nothing. Analytics: rain_print_year_signup {daily: 0|1}, nothing else (no
     address, no design code, no place). */
  var YA = { key: '', inp: '', st: {} };
  function yearAskOff() {
    var w = $('rp-yearask');
    YA.key = ''; YA.inp = '';
    if (w) { w.hidden = true; w.innerHTML = ''; }
  }
  function rainCounties(st) {
    if (!YA.st[st]) {
      YA.st[st] = root.fetch('/data/rain/' + st + '.json').then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) { return j && j.counties && typeof j.counties === 'object' ? j.counties : null; })
        .catch(function () { delete YA.st[st]; return null; });
    }
    return YA.st[st];
  }
  function syncYearAsk(my) {
    var w = $('rp-yearask');
    if (!w) return;
    var st = META ? String(META.stateAbbr || '').toLowerCase() : '';
    var ok = !!(DATA && !BLOCKED && !SAMPLE && !MAKER && META && !META.ca && !META.approx && META.county && /^[a-z]{2}$/.test(st)
      && ST.year === CURRENT_YEAR && !(typeof GIFT !== 'undefined' && GIFT && GIFT.usable) && typeof root.fetch === 'function');
    if (!ok) { yearAskOff(); return; }
    var key = ST.year + '|' + META.place + '|' + META.county;
    if (key === YA.key) return;
    yearAskOff();
    YA.key = key; YA.inp = ST.year + '|' + ST.place;
    var y = ST.year;
    rainCounties(st).then(function (cs) {
      if (YA.key !== key || my !== reqToken) return;
      var fips = countyFips(META.county, cs);
      if (!fips) return;
      var name = cs[fips].name;
      w.innerHTML = '<div data-signup-ask="Email me when ' + y + ' is finished." data-topic="rainyear:' + y + ':' + fips + '" data-source="page:rain-print"'
        + ' data-ok="' + esc('Done. One email in January, once NOAA has all of ' + y + ' for ' + name + '.') + '"'
        + ' data-note="' + esc('One email: ' + name + '’s full ' + y + ' rain total, and word that the whole year can be printed.') + '"></div>';
      var el = w.firstChild, daily = false;
      w.hidden = false;
      // signup-ask.js not in yet: its own scan mounts the card when it loads
      if (root.AgsistSignup && typeof root.AgsistSignup.mount === 'function') root.AgsistSignup.mount(el);
      if (el.hidden) { w.hidden = true; return; }   // already asked for in this browser
      el.addEventListener('submit', function () { var d = el.querySelector('.sa-d input'); daily = !!(d && d.checked); }, true);
      if (typeof root.MutationObserver === 'function') new root.MutationObserver(function (ms, ob) {
        if (!el.getAttribute('data-sa-done')) return;
        ob.disconnect();
        ga('rain_print_year_signup', { daily: daily ? 1 : 0 });
      }).observe(el, { attributes: true, attributeFilter: ['data-sa-done'] });
    });
  }
  function blockPrint(msg) {
    yearAskOff();
    BLOCKED = msg;
    PREVIEW = null; SETTLE = false; NOART = '';
    art.innerHTML = '<p class="rp-placeholder">Too many days missing at this station for a fair print.</p>';
    art.classList.add('rp-empty');
    $('rp-stats-wrap').hidden = true;
    $('rp-source').textContent = '';
    $('rp-code-wrap').hidden = true;
    $('ro-design').value = '';
    $('rp-order').hidden = true;
    showBuy(false);
    sampleLine(false);
    setStatus(msg, true);
  }
  /* A draw that failed (a misspelled town, a slow NOAA, no station): the old
     design comes down with it, so nothing stale can be ordered (2026-10-13:
     "Chetk, WI" left Chetek's art and live order buttons up). */
  /* A redraw failed with a print up: that print comes back, and the line by
     the town box says what didn't draw and that the print is still the one
     before. The boxes keep what the reader typed, so Try again (or Draw)
     tries it again; ordering waits until they match the print (staleInputs). */
  function keepWords(want, had, err) {
    var what = (want.place && want.place !== had.place ? want.place + ', ' : '') + want.year, msg = String(err && err.message || '');
    var keep = ' Your ' + (want.place && want.place !== had.place ? had.place + ', ' : '') + had.year + ' print is still here.';
    if (err && err.retry) {
      var code = err.status ? [0, err.status] : /error (\d{3})/.exec(msg), who = /town lookup/.test(msg) ? 'the town lookup' : 'NOAA';
      return 'Couldn\u2019t draw ' + what + ' just now (' + (code ? who + ' error ' + code[1] : /slow/.test(msg) ? who + ' is slow' : who + ' didn\u2019t answer') + ').' + keep;
    }
    return (msg || 'Couldn\u2019t draw ' + what + '.') + keep;
  }
  function keepDrawn(snap, err) {
    var want = ST;
    ST = snap.ST; DATA = snap.DATA; META = snap.META; STATIONS = snap.STATIONS; EXT = snap.EXT; NORM30 = snap.NORM30;
    PREVIEW = snap.PREVIEW; SETTLE = snap.SETTLE; STUCK = snap.STUCK; EXT_WAIT = snap.EXT_WAIT; NORM_WAIT = snap.NORM_WAIT; NOART = ''; BLOCKED = '';
    // the print put back was still waiting for its normal: ask again
    if (NORM_WAIT) {
      var back = reqToken;
      stationNormal(META.sid, ST.year).catch(function () { return null; }).then(function (n) {
        if (back !== reqToken || !DATA) return;
        NORM30 = n; NORM_WAIT = false; STUCK = stuckRun(DATA.days, NORM30); render();
      });
    }
    $('rp-station').innerHTML = snap.sel; $('rp-station').value = ST.station;
    art.classList.remove('rp-empty');
    render();
    if (err && err.pick) { showPick(err.pick); setStatus('There\u2019s more than one ' + err.pick[0].name + '. Which one?' + ' Your ' + ST.year + ' print is still here.'); return; }
    // NOAA or the town lookup slow: a plain note with Try again, not the warning color (2026-10-16)
    setStatus(againWords(keepWords(want, ST, err)), !(err && err.retry));
    $('rp-retry-row').hidden = !(err && err.retry);
  }
  function failDraw(err) {
    DATA = null; META = null; PREVIEW = null; SETTLE = false; NOART = ''; EXT = null; NORM30 = null;
    BLOCKED = 'failed';
    yearAskOff();
    art.innerHTML = EMPTY_ART;
    art.classList.add('rp-empty');
    $('rp-stats-wrap').hidden = true;
    $('rp-source').textContent = '';
    $('rp-preview-line').hidden = true;
    $('rp-code-wrap').hidden = true;
    $('ro-design').value = '';
    $('rp-order').hidden = true;
    showBuy(false);
    sampleLine(false);
    if (err && err.pick) { showPick(err.pick); setStatus('There\u2019s more than one ' + err.pick[0].name + '. Which one?'); return; }
    // a slow NOAA is nobody's fault: said plainly, with Try again, not in the warning color (2026-10-16)
    setStatus(againWords(err && err.message ? err.message : 'The print didn\u2019t draw. Try again. If it fails twice, try another town or year.'), !(err && err.retry));
    $('rp-retry-row').hidden = !(err && err.retry);
  }
  /* The same failure again (2026-10-17, money panel: after a town lookup 504,
     a second Draw looked like it did nothing, because the same words came
     back). Draw does ask again; the line says so and counts the tries. */
  var FAIL_LAST = '', FAIL_N = 0;
  function againWords(msg) {
    FAIL_N = msg === FAIL_LAST ? FAIL_N + 1 : 1; FAIL_LAST = msg;
    return FAIL_N > 1 ? 'Asked again just now (' + FAIL_N + ' tries). ' + msg : msg;
  }
  // "Which Springfield?": one button per town, with its county
  function showPick(list) {
    var box = $('rp-pick');
    box.innerHTML = '';
    list.forEach(function (x) {
      var b = doc.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.textContent = placeLabel(x) + (x.admin2 ? ' (' + x.admin2 + (/county|parish|borough/i.test(x.admin2) ? '' : ' County') + ')' : '');
      b.addEventListener('click', function () {
        var q = placeLabel(x);
        PICKED = { q: q, hit: x };
        $('rp-place').value = q;
        // the button is about to vanish: keep the keyboard on the town box
        try { $('rp-place').focus({ preventScroll: true }); } catch (err) {}
        box.hidden = true;
        run({ type: 'submit', preventDefault: function () {} });
      });
      box.appendChild(b);
    });
    box.hidden = false;
    try { box.querySelector('button').focus(); } catch (e) {}
  }

  /* COUNTY LINKS (2026-10-14). A county rain page links here with its
     station's own place: ?ll=lat,lon. On that link's first draw the station
     search centers there, so the named station is found even when the town
     lookup misses or finds another town of that name. Distances still run from
     the town; when the town can't be found the print says "near" it instead of
     a distance it doesn't know. */
  var LINK_LL = (function () {
    var q = new URLSearchParams(root.location.search), m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(q.get('ll') || '');
    if (!m) return null;
    var lat = +m[1], lon = +m[2];
    return lat >= 15 && lat <= 72 && lon >= -180 && lon <= -60 ? { lat: lat, lon: lon, place: ST.place } : null;
  })();
  function llTown(ll) {
    var q = geocodeQuery(ST.place), full = STATE[q.st];
    return { name: parts0(ST.place), admin1: full ? toTitle(full) : '', latitude: ll.lat, longitude: ll.lon, approx: true };
  }
  var PICKED = null;   // {q, hit}: the town the reader chose from a "which one?" list
  function geocode(q) { return PICKED && PICKED.q === q ? Promise.resolve(PICKED.hit) : geoFind(q); }
  var reqToken = 0;
  function run(e, preset) {
    if (e && !e.auto) fontsSoon();   // the reader's own draw; the sample waits for the page's load
    if (e) e.preventDefault();
    var next;
    if (preset) next = preset;
    else {
      if (SAMPLE) {
        // The reader's own draw replaces the sample. An empty town keeps the sample up and says what is missing.
        var want = readInputs();
        if (!want.place) { statusEl.textContent = 'Type a town and state, like Chetek, WI.'; statusEl.classList.add('rp-bad'); return; }
        clearSample();
        ST.station = '';
      }
      var fromUrlStation = ST.station;
      next = readInputs();
      if (e && e.type === 'submit' && (next.place !== ST.place || next.year !== ST.year)) next.station = '';
      else next.station = fromUrlStation;
    }
    /* Nothing changed since the print that is up (Draw pressed again, the
       same year picked again): nothing to do. Unless part of it didn't load
       (loadFail): then Draw is how the reader asks for it again. */
    if (!preset && e && DATA && META && !SAMPLE && !BLOCKED && !DRAWING && !loadFail() && next.station === META.sid &&
        next.place === ST.place && next.year === ST.year && encodeCode(next) === encodeCode(ST)) {
      // the print is already this one: on a phone the keyboard still goes, as after a draw
      if (phone() && doc.activeElement === $('rp-place')) try { $('rp-place').blur(); } catch (err) {}
      return;
    }
    /* The print that is up, kept until the next one is in: a redraw that
       fails (NOAA down, a town not found) puts it back instead of leaving an
       empty frame (2026-10-15). */
    var snap = DATA && META && !SAMPLE && !BLOCKED ? { ST: ST, DATA: DATA, META: META, STATIONS: STATIONS, EXT: EXT, NORM30: NORM30, PREVIEW: PREVIEW,
      SETTLE: SETTLE, STUCK: STUCK, EXT_WAIT: EXT_WAIT, NORM_WAIT: NORM_WAIT, sel: $('rp-station').innerHTML } : null;
    abortLive();
    var my = ++reqToken;
    // the reader's own draw: the example words come off the print at the top, and the town is theirs now, not a guess from where they are
    if (e) { KEEP_URL = false; SHOW_EX = false; }
    if (e && e.type === 'submit' && !preset) NEAR = '';
    ST = next;
    // another town or year: the last draw's email card goes until this one is drawn
    if (YA.inp && YA.inp !== ST.year + '|' + ST.place) yearAskOff();
    if (ST.records) recordsReady();
    $('rp-buy-note').textContent = ''; BUY_NOTE_CODE = ''; $('rp-noname').hidden = true;
    // a note about the last draw's station is about that draw only
    if (!$('rp-link-note').classList.contains('rp-bad')) $('rp-link-note').hidden = true;
    var go = $('rp-go'), sel = $('rp-station');
    // Draw is about to turn off: keep the keyboard on the town box, not lost on the page
    if (doc.activeElement === go) { try { $('rp-place').focus({ preventScroll: true }); } catch (err) {} }
    go.disabled = true; sel.disabled = true;
    // nothing drawn yet: say what is being drawn, and tell a screen reader the box is busy
    if (!DATA && !SAMPLE && ST.place && ST.year && !art.querySelector('.rp-ex')) {
      art.innerHTML = '<p class="rp-placeholder">Drawing ' + esc(ST.place) + ', ' + ST.year + ' from NOAA records\u2026</p>';
      art.classList.add('rp-empty');
    }
    art.setAttribute('aria-busy', 'true');
    BLOCKED = ''; DRAWING = true;
    $('rp-retry-row').hidden = true;
    if (!preset) $('rp-pick').hidden = true;
    showBuy(!!DATA);
    var g, chosen, picked, autoPick = false, why = null, artShown = false, readErr = null, seen = SNOW_SEEN[ST.year] = SNOW_SEEN[ST.year] || {};
    /* the county page's station location, for its own link's town only. A link
       with no station (last year's print from a county page, 2026-10-19, or a
       station that missed too many days) searches around that spot too, so a
       station town the lookup can't find still draws, from the nearest good record. */
    var ll = LINK_LL && LINK_LL.place === ST.place ? LINK_LL : null;
    var done = function () { if (my === reqToken) { art.removeAttribute('aria-busy'); DRAWING = false; go.disabled = go.hasAttribute('data-gift-lock'); sel.disabled = STATIONS.length < 2 || sel.hasAttribute('data-gift-lock'); showBuy(canOrder()); } };
    // the town lookup starts now, beside rain-print.json, not after it (2026-10-15)
    var geoEarly = ST.place ? geocode(ST.place).then(function (h) { return { h: h }; }, function (x) { return { x: x }; }) : null;
    Promise.resolve(PRICES_P).then(function () {
      if (!ST.place) throw new Error('Type a town and state, like Chetek, WI.');
      if (!ST.year) throw new Error('Pick a year.');
      var mode = yearMode(ST.year, TODAY);
      if (mode === 'future') throw new Error(ST.year + ' hasn\u2019t happened yet. Pick ' + CURRENT_YEAR + ' to give this year as a gift, or an earlier year.');
      ST.gift = mode === 'gift';
      GEO_LANG = LOC().lang;
      setStatus(L('Finding ', 'Recherche de ') + ST.place + '…');
      // Only a link that names its station (a county rain page) gets the shorter tries.
      var tries = ST.station ? shorterPlaces(ST.place) : [];
      /* A design that names its station but carries no ?ll= (a shared code,
         Sig's ?d=...&maker=1 view of a county-link order): the station's own
         place from NOAA checks the town, the way ll does on the link itself.
         A town the lookup can't find, or one more than 60 km from the station,
         is another town of that name: the print says "near" the town at the
         station's place, as the buyer saw it (2026-10-15, Rathbun, IA). */
      var stnLL = !ll && ST.station ? daily(ST.station, ST.year).then(function (d) {
        var m = d && d.meta && d.meta.ll;
        return Array.isArray(m) && m.length >= 2 && isFinite(m[0]) && isFinite(m[1]) ? { lat: +m[1], lon: +m[0] } : null;
      }, function () { return null; }) : null;
      var byStation = function (hit) {
        return Promise.resolve(stnLL).then(function (sl) { return sl && haversine(hit.latitude, hit.longitude, sl.lat, sl.lon) > 60 ? llTown(sl) : hit; });
      };
      var noTown = function (err) {
        return Promise.resolve(stnLL).then(function (sl) {
          if (!sl || err === 'stale') throw err;
          // several towns of that name: the one by the station, when one is
          if (err && err.pick) {
            var near = err.pick.filter(function (x) { return haversine(x.latitude, x.longitude, sl.lat, sl.lon) <= 60; })
              .sort(function (a, b) { return haversine(a.latitude, a.longitude, sl.lat, sl.lon) - haversine(b.latitude, b.longitude, sl.lat, sl.lon); });
            if (near.length) return near[0];
          }
          return llTown(sl);
        });
      };
      var geoP = geoEarly ? geoEarly.then(function (r) { if ('x' in r) throw r.x; return r.h; }) : geocode(ST.place);
      return geoP.catch(function (first) {
        if (first && first.pick) throw first;
        // a shorter try that finds several towns is skipped; the reader sees the first error
        var next = function () {
          var q = tries.shift();
          if (!q) throw first;
          return geocode(q).then(function (hit) { ST.place = cleanText(placeLabel(hit), LIMITS.place); $('rp-place').value = ST.place; return hit; }, next);
        };
        return next();
      }).then(function (hit) {
        // a town found far from the linked station is another town of that name
        return ll && haversine(hit.latitude, hit.longitude, ll.lat, ll.lon) > 60 ? llTown(ll) : byStation(hit);
      }, function (err) {
        // the county page's station town isn't a town the lookup knows: the station's own place stands in
        if (ll && err !== 'stale') return llTown(ll);
        return noTown(err);
      });
    }).then(function (res) {
      if (my !== reqToken) throw 'stale';
      g = res;
      // a ZIP or a picked town: the print, the link and the order name the town found
      // "Ames IA" with no comma: the box and the order say "Ames, IA" once the town is found
      if (geocodeQuery(ST.place).zip || (ST.place.indexOf(',') < 0 && !g.approx && geocodeQuery(ST.place).st)) { ST.place = cleanText(placeLabel(g), LIMITS.place); $('rp-place').value = ST.place; }
      var gCa = g.country_code === 'CA' || isCanada(ST.station);
      setStatus(gCa ? L('Looking for weather stations near ', 'Recherche des stations météo près de ') + g.name + '…' : 'Looking for NOAA stations near ' + g.name + (g.admin1 ? ', ' + g.admin1 : '') + '…');
      // a county link searches around its own station, so that station is in the list
      NEXT_CA = gCa;
      return stations(ll ? ll.lat : g.latitude, ll ? ll.lon : g.longitude, ST.year);
    }).then(function (list) {
      if (my !== reqToken) throw 'stale';
      // distances on the page are from the town, wherever the search was centered
      if (ll) list = list.map(function (s) { return Object.assign({}, s, { km: haversine(g.latitude, g.longitude, s.ll[1], s.ll[0]) }); }).sort(function (a, b) { return a.km - b.km; });
      STATIONS = list;
      var noStation = function () {
        if (g.country_code === 'CA') return new Error(ST.gift ? L('No weather station within 70 km of ', 'Aucune station météo à moins de 70 km de ') + g.name + L(' is reporting for ' + ST.year + ' from January 1 on. Try a bigger town nearby.', ' n’a de relevés pour ' + ST.year + ' depuis le 1er janvier. Essayez une plus grande ville proche.')
          : L('No weather station within 70 km of ', 'Aucune station météo à moins de 70 km de ') + g.name + L(' has all of ' + ST.year + ' on record. Try a bigger town nearby, or another year.', ' n’a toute l’année ' + ST.year + '. Essayez une plus grande ville proche, ou une autre année.'));
        return new Error(ST.gift ? 'No NOAA station near ' + g.name + ' is reporting for ' + ST.year + ' from January 1 on. Try a bigger town nearby.'
          : 'No NOAA station near ' + g.name + ' has all of ' + ST.year + ' on record. Try a bigger town nearby, or another year.');
      };
      /* A link that names its station (a county rain page, a shared design)
         draws that station, even when the station list here missed it (the box
         around the town, a record that starts after Jan 1, the stale filter).
         When NOAA won't give it, the nearest good station draws instead and
         the note under the town box says so (2026-10-14: it was swapped, or
         stuck, without a word). */
      var linked = ST.station, want = linked ? list.find(function (s) { return s.sid === linked; }) : null;
      var instead = function () {
        if (my !== reqToken) throw 'stale';
        /* A gift card's locked design keeps its station: no quiet re-pick,
           the reader tries again instead (2026-10-15). */
        if (GIFT && GIFT.lock && GIFT.lock.design) {
          var gl = new Error('NOAA didn\u2019t send the station on your gift card (' + sidPlain(linked) + ') just now. Try again in a minute.');
          gl.retry = true; throw gl;
        }
        ST.station = '';
        var n = $('rp-link-note');
        n.textContent = 'The station in the link (' + sidPlain(linked) + ') didn\u2019t answer from NOAA just now, so this print uses the nearest station with a good record.';
        n.classList.remove('rp-bad'); n.hidden = false;
        return nearest(linked);
      };
      if (want) return daily(want.sid, ST.year).then(function (d) { chosen = want; picked = d; seen[want.sid] = snowStateOf(d.days); }, instead);
      if (linked) return daily(linked, ST.year).then(function (d) {
        if (!d || !d.meta || !Array.isArray(d.meta.ll) || d.meta.ll.length < 2) throw new Error('no place for that station');
        chosen = { sid: linked, name: d.meta.name || linked, state: d.meta.state || '', ll: d.meta.ll, km: haversine(g.latitude, g.longitude, d.meta.ll[1], d.meta.ll[0]),
          valid_daterange: [[ST.year + '-01-01', lastDayOf(ST.year)]] };
        STATIONS = [chosen].concat(list);
        picked = d; seen[linked] = snowStateOf(d.days);
      }).catch(function (err) { if (err === 'stale') throw err; return instead(); });
      // every year behind your year: the nearest station with HIST_MIN full years, drawn from that station (Staircase)
      if (wantHist()) return nearestLong();
      return nearest('');
      /* Nearest first; take the first of three with a near-complete year, else the most complete,
         then trade a few miles for a snowfall record where snow is normal (pickStation). skip: a station that just failed.
         Only a design without its own station gets here: a link's, a gift card's or a saved station is never re-picked. */
      function nearestLong() {
        autoPick = true;
        return pickLong(list, ST.year, function (s) { setStatus('Reading the full record at ' + stationName(s.name) + '\u2026'); }).then(function (r) {
          if (my !== reqToken) throw 'stale';
          if (!r) { HIST_WHY = 'None of the nearest stations with a long record has ' + HIST_MIN + ' full years and a good ' + ST.year + ', so the history threads are off.'; return nearest(''); }
          HIST_WHY = ''; picked = r.picked; chosen = r.chosen; why = null; seen[chosen.sid] = snowStateOf(picked.days);
        });
      }
      function nearest(skip) {
        var pool = list.filter(function (s) { return s.sid !== skip; });
        if (!pool.length) throw noStation();
        autoPick = true;
        var readNow = function (sid, y) { return my === reqToken ? daily(sid, y).catch(function (er) { readErr = er; throw er; }) : Promise.reject('stale'); };
        return pickStation(pool, ST.year, readNow, { lat: g.latitude, onTry: function (s, kind) {
          setStatus(kind === 'snow' ? L('Checking ', 'Vérification de ') + stationName(s.name) + L(', which records snowfall too…', ', qui mesure aussi la neige…') : L('Reading ', 'Lecture de ') + stationName(s.name) + L(' for ', ' pour ') + ST.year + '…');
        } }).then(function (r) {
          if (my !== reqToken) throw 'stale';
          picked = r.picked; chosen = r.chosen; why = r.why;
          Object.keys(r.seen).forEach(function (k) { seen[k] = r.seen[k]; });
        });
      }
    }).then(function () {
      if (my !== reqToken) throw 'stale';
      // This year with nothing back yet: the station is still the one for the print, so ordering stays open.
      if (!picked && ST.gift) { chosen = STATIONS[0]; picked = { meta: {}, days: [], d: derive([]) }; }
      if (!picked) { var none = new Error('None of the stations near ' + g.name + ' sent back ' + ST.year + '. Try again in a minute.'); none.retry = true; none.status = readErr && readErr.status; throw none; }
      ST.station = chosen.sid;
      sel.innerHTML = STATIONS.map(function (s) {
        var w = s.ca && CA() ? CA().snowWord(seen && seen[s.sid], s.snowOk, LOC().lang) : snowWord(s, seen);
        return '<option value="' + esc(s.sid) + '">' + esc(stationName(s.name)) + ', ' + (s.ca && CA() ? CA().kmText(s.km, LOC().lang) + ', ' + s.valid_daterange[0][0].slice(0, 4) + '\u2013' + s.valid_daterange[0][1].slice(0, 4)
          : milesText(miles(s.km)) + ', ' + s.valid_daterange[0][0].slice(0, 4) + '\u2013' + s.valid_daterange[0][1].slice(0, 4)) + (w ? ', ' + w : '') + '</option>';
      }).join('');
      sel.value = chosen.sid;
      var caM = !!(chosen.ca || (CA() && CA().isSid(chosen.sid)));
      var stateAbbr = caM ? String(g.prov || picked.meta.state || '').toUpperCase() : abbrFor((g.admin1 || '').toLowerCase()) || picked.meta.state || '';
      META = { approx: !!g.approx, name: picked.meta.name || chosen.name, state: picked.meta.state || chosen.state || '', stateAbbr: stateAbbr, year: ST.year, km: chosen.km, place: g.name + ', ' + (stateAbbr || g.admin1), city: g.name, sid: chosen.sid, why: autoPick ? why : null, lat: g.latitude, lon: g.longitude, county: caM || g.approx ? '' : String(g.admin2 || '') };
      // a Canadian print: its province, its source (ECCC or CoCoRaHS) and a postal lookup for the credits; the toggles show
      if (caM) { META.ca = true; META.prov = stateAbbr.toLowerCase(); META.src = picked.meta.src || chosen.src || ''; META.postal = g.postal || ''; }
      syncCa();
      if (picked.d.missing > MISS_BLOCK) {
        DATA = null;
        blockPrint(stationName(META.name) + ' has ' + picked.d.missing + ' unrecorded days in ' + ST.year + '. They would print as dry spells that may not have been dry. ' +
          (!autoPick && STATIONS.length > 1 ? 'Pick another station under Weather station, or another year.'
            : Math.min(3, STATIONS.length) === 1 ? 'The only station near ' + g.name + ' doesn\u2019t have enough of ' + ST.year + ' on record. Try another year, or a bigger town nearby.'
            : 'None of the ' + Math.min(3, STATIONS.length) + ' nearest stations has enough of ' + ST.year + ' on record. Try another year, or a bigger town nearby.'));
        throw 'blocked';
      }
      if (ST.gift && picked.days.length < GIFT_MIN_DAYS) {
        DATA = null; PREVIEW = null; SETTLE = false;
        NOART = (picked.days.length ? 'This station only has ' + ST.year + ' through ' + longDate(picked.days[picked.days.length - 1].date) + ', too little to draw a fair preview. ' : 'No days of ' + ST.year + ' have come in from this station yet. ') +
          'You can still order it as a gift. The full-year print is drawn and sent in January.';
        yearAskOff();
        renderNoArt();
        setStatus('No preview yet, but you can still order it.');
        throw 'noart';
      }
      DATA = { days: picked.days, d: picked.d, raw: picked.raw }; NOART = ''; STUCK = null;
      var yearLen = isLeap(ST.year) ? 366 : 365, notIn = !ST.gift && lastYearOpen(ST.year) && picked.days.length < yearLen;
      PREVIEW = ST.gift || notIn ? { last: picked.days[picked.days.length - 1].date, yearLen: yearLen } : null;
      SETTLE = notIn || (!ST.gift && settlingByDate(ST.year));
      setStatus(META.ca ? L('Reading the 1991\u20132020 averages…', 'Lecture des moyennes 1991\u20132020…') : 'Reading the 30-year normal at ' + stationSaid(META) + '…');
      /* The station's full record (every year it has kept) is the big download
         and only the station-average comparison and the year and month records
         need it, so the print draws without waiting for it and draws again when
         it is in (2026-10-13). The station-average comparison still waits. */
      EXT = EXT_CACHE.get(chosen.sid) || null;
      EXT_WAIT = !EXT;
      var por = stationExtremes(chosen.sid).catch(function () { return null; });
      if (EXT_WAIT) por.then(function (x) {
        if (my !== reqToken) return;
        EXT = x; EXT_WAIT = false;
        if (DATA && !BLOCKED) { render(); drawnStatus(); }
      });
      /* The print draws the moment the year's days are in; the 30-year normal
         line joins it when it comes (2026-10-15: the frame stayed empty for
         another NOAA ask). The station-average comparison still waits for the
         full record. */
      var normP = stationNormal(chosen.sid, ST.year).catch(function () { return null; });
      if (ST.cmp !== 'station' && !NORM_CACHE.has(chosen.sid + '|' + ST.year)) {
        NORM30 = null; STUCK = null; NORM_WAIT = true;
        render();
        if (!SAMPLE) { setStatus(META.ca ? L('Drawn. Adding the usual year\u2026', 'Dessiné. Ajout de l’année normale\u2026') : 'Drawn. Adding the 30-year normal from ' + stationSaid(META) + '\u2026'); if (e && !e.auto) { showArt(); artShown = true; } }
      }
      return Promise.all([ST.cmp === 'station' ? por : null, normP]);
    }).then(function (res) {
      if (my !== reqToken) throw 'stale';
      if (res[0]) { EXT = res[0]; EXT_WAIT = false; }
      NORM30 = res[1]; NORM_WAIT = false;
      STUCK = stuckRun(DATA.days, NORM30);
      drawnStatus();
      render();
      if (SAMPLE) setStatus(EMPTY_STATUS);
      else {
        ga('rain_print_draw', { style: ST.style, near: NEAR && ST.place === NEAR ? 1 : 0, year_kind: yearMode(ST.year, TODAY) || 'done' });
        syncYearAsk(my);
        // a phone: the keyboard goes once the print is drawn, so the town box doesn't hold the page (2026-10-15)
        if (phone() && doc.activeElement === $('rp-place')) try { $('rp-place').blur(); } catch (err) {}
        if (e && !e.auto && !artShown) showArt();
      }
      if (ST.records) recordsReady().then(function (ok) { if (ok && DATA && my === reqToken) render(); });
      extrasLoad(my);
    }).catch(function (err) {
      if (err === 'stale') return;
      if (SAMPLE) {
        /* The sample failed. The reader pressed nothing, and the example print
           in the page's HTML is still in the frame, so the page says nothing:
           no error they didn't cause (2026-10-16, benchmark R1; was a red
           "NOAA isn't answering" line on load). A slow NOAA shows only after
           their own Draw, calmly, with Try again (failDraw). */
        if (my === reqToken) clearSample();
        return;
      }
      if (err === 'blocked' || err === 'noart') return;
      if (my !== reqToken) return;
      // the town came from the reader's connection, not from them: no red error for a town they never typed
      if (!e && !preset && NEAR && ST.place === NEAR) { NEAR = ''; $('rp-place').value = ''; runSample(); return; }
      if (snap) { keepDrawn(snap, err); return; }
      failDraw(err);
    }).then(done);
  }

  // the status line once a print is up
  function drawnStatus() {
    if (!DATA || !META) return;
    FAIL_LAST = ''; FAIL_N = 0;
    if (META.ca && FR()) { setStatus('Dessiné à partir des relevés de ' + META.name + '.' + (PREVIEW ? ' Aperçu jusqu’au ' + PREVIEW.last.slice(8).replace(/^0/, '') + ' ' + ((root.AgRainArt && root.AgRainArt.MON_FR) || MON3)[+PREVIEW.last.slice(5, 7) - 1] + '.' : '')); return; }
    setStatus('Drawn from the records at ' + stationSaid(META, true) + '.' +
      (PREVIEW ? ' Preview through ' + longDate(PREVIEW.last) + '.' : '') +
      (EXT_WAIT && ST.records && !PREVIEW ? ' Still reading the station\u2019s full history for the remarkable days\u2026' : '') +
      (loadFail() ? ' ' + loadFail() + ' Press Draw again.' : ''));
  }
  function restyle(soon) {
    var next = readInputs();
    if (SAMPLE) { next.place = ST.place; next.year = ST.year; sampleWords(next); }   // style choices try out on the sample
    /* The town box changed and isn't drawn yet (or a draw is on its way): the
       words still go on the print that is up, in its year (2026-10-14: every
       word typed was ignored until Draw it, panel 4). The line by the print
       says the new town waits; the order waits for the draw. */
    else if (next.year !== ST.year || next.place !== ST.place) { next = readInputs(ST.year); next.place = ST.place; next.year = ST.year; }
    next.station = ST.station;
    next.gift = ST.gift;
    ST = next;
    syncLogoUi();
    syncPending();
    if (ST.records && !root.AgRainRecords) recordsReady().then(function (ok) { if (ok) render(); });
    if (soon) redrawSoon(); else { flushRedraw(true); render(); }
  }
  /* Typing: the design takes each letter at once (ST above), the drawing
     follows a frame and about 150 ms of quiet later, not on every key
     (2026-10-15: a phone redrew the whole print per letter). Anything that
     reads the drawing (checkout, the review sheet, the order form) flushes it. */
  var REDRAW_T = 0;
  function redrawSoon() {
    clearTimeout(REDRAW_T);
    REDRAW_T = setTimeout(function () { (root.requestAnimationFrame || setTimeout)(function () { if (REDRAW_T) { REDRAW_T = 0; URL_LAZY = true; try { render(); } finally { URL_LAZY = false; } } }); }, 150);
  }
  function flushRedraw(drop) {
    if (!REDRAW_T) return;
    clearTimeout(REDRAW_T); REDRAW_T = 0;
    if (!drop) render();
  }

  // ---------- prices and buying ----------
  function money(n) { return '$' + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(n)); }
  function loadPrices() {
    return fetch('/data/rain-print.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || typeof j.digital !== 'number') return;
      PRICES = j;
      if (/^\d{2}-\d{2}$/.test(j.full_year_from || '')) FULL_YEAR_FROM = j.full_year_from;
      PRODUCTS.forEach(function (id) {
        var el = doc.querySelector('[data-price="' + id + '"]');
        if (el && typeof j[id] === 'number') el.textContent = money(j[id]);
      });
      if (j.ships_within) $('rp-ships').textContent = j.ships_within;
      if (j.gift_delivery) $('rp-gift-delivery').textContent = fill(j.gift_delivery);
      /* Lost or damaged in shipping: replaced free, same serial number (Sig, 2026-10-18; was $15).
         The FAQ says so in the page itself; no fee comes from data/rain-print.json. */
      syncCutoffs();
      var xp = !PICK_CHOSEN && !januaryGift() ? xmasPick(TODAY, OJ().j) : '';
      if (xp && xp !== PICK) setPick(xp);
      syncXmas();
      var o = $('rp-year').querySelector('option[value="' + CURRENT_YEAR + '"]');
      if (o) o.textContent = giftYearLabel();
      syncBiz();
      syncCa();
      syncAddress();
      syncPick();
      if (PAID) showPaid(PAID, PAID_SAVED, true);
    }).catch(function () { if (PAID) showPaid(PAID, PAID_SAVED, true); });
  }
  function payLink(id) {
    var J = OJ().j, l = J && J.payment_links && J.payment_links[id];
    return typeof l === 'string' && /^https:\/\/[^\s"<>]+$/.test(l) ? l : '';
  }
  /* THE ORDER (2026-10-14, the approved flow). Step 3 is one picker, framed
     first, and one button whose words follow the pick ("Check it and pay
     $89"). With no name on the print it asks once: add one, or check out
     without. Then it opens "Your print" as the review sheet: the details in
     words, the same picker, a tick for the spelling and the dates, and the
     button that pays. Checkout is Stripe in the same tab (Sig): the design is
     in the address bar and saved for the way back, and Stripe sends the buyer
     back to rain-print?paid=<product>&s=<session> (PAID below). */
  var PICK = 'framed12x18', NONAME_OK = false, PICK_CHOSEN = false;
  /* PAST A CUTOFF (2026-10-17, gift-buyers panel): Framed stays picked only
     while it still makes Christmas. Past its date the page starts on the best
     choice that still does, the print through its own date, then the digital
     file, unless the reader (or their link) already picked. Outside Oct 1 to
     Dec 25, or for this year's January gift, nothing moves. */
  function xmasPick(today, j) {
    var pc = j && j.print_christmas_cutoff, fc = j && j.framed_christmas_cutoff, M = /^\d{4}-\d{2}-\d{2}$/;
    if (!M.test(String(pc || '')) || !M.test(String(fc || '')) || !M.test(String(today || ''))) return '';
    if (today < fc.slice(0, 4) + '-10-01' || today > fc.slice(0, 4) + '-12-25' || today <= fc) return '';
    return today <= pc ? 'print12x18' : 'digital';
  }
  var PICK_WORD = { framed12x18: 'Framed', print12x18: 'Print', digital: 'Digital file' };
  // a Canadian design reads "US$19": the prices are in US dollars
  function pickPrice(id) { var J = OJ().j || {}; return typeof J[id] === 'number' ? (caOrder() ? 'US' : '') + money(J[id]) : ''; }
  function setPick(id) {
    if (PRODUCTS.indexOf(id) < 0) return;
    if (blockedPick(id)) id = 'digital';   // not shipped to Canada yet (data/rain-print.json canada.ships)
    PICK = id;
    radios('rp-product').forEach(function (r) { r.checked = r.value === id; });
    radios('rp-pproduct').forEach(function (r) { r.checked = r.value === id; });
    // the print at the top shows what is picked: framed, or the print alone (the file is the print alone too)
    setView(id === 'framed12x18' ? 'framed' : 'print');
    syncPick();
    if ($('rp-proof').open) proofRender();
  }
  function syncPick() {
    var p = pickPrice(PICK), link = !!payLink(PICK);
    $('rp-pay').textContent = 'Check it and pay' + (p ? ' ' + p : '');
    $('rp-bar-what').textContent = PICK_WORD[PICK] + (p ? ' \u00b7 ' + p : '');
    $('rp-promise').textContent = PICK === 'digital' ? 'No proof for the file: it comes finished. Want a change after? Write to me and I\u2019ll redo it.'
      : 'You see a proof first, and get a full refund any time before I print.';
    /* One gift instruction, said once (2026-10-17, gift-buyers panel): with a
       payment link, the line above Pay says what to do on the next screen, and
       the line under the mockup goes. Without one, the order form takes it. */
    var giftOff = januaryGift() || !!(GIFT && GIFT.usable);
    $('rp-gift-line').textContent = 'It\u2019s a gift? Say so on the order form, with their name and your note.';
    $('rp-gift-line').hidden = giftOff || link;
    $('rp-gift-pre').innerHTML = PICK === 'digital' ? 'A gift? On the next screen, before you pay, tick <b>This is a gift</b> and add their name and your note. I send the note with the file, and no prices go with it.'
      : 'A gift? On the next screen, before you pay, tick <b>This is a gift</b> and add their name and your note; Stripe asks where to ship it. I print your note at the top of the letter in the box, free, and no prices go in the box.';
    $('rp-gift-pre').hidden = giftOff || !link || !canOrder();
    $('rp-another-wrap').hidden = !canOrder() || !!(GIFT && GIFT.usable);
    pgSync();
    // the file: no shipping line, no Christmas proof dates; it says what the file is (2026-10-15)
    $('rp-ships').hidden = PICK === 'digital';
    $('rp-madeby').textContent = MADE_BY[PICK === 'digital' ? 'file' : 'print'];
    // when it comes: this year's gift ships in January and a year NOAA hasn't finished waits, so those say so instead
    var arr = januaryGift() || (SETTLE && canOrder()) || (GIFT && GIFT.usable) ? '' : arriveText(OJ().j, PICK, TODAY);
    // the prices at the top and the shipping line follow the country (Canada: data/rain-print.json canada)
    var OJj = OJ().j || {};
    PRODUCTS.forEach(function (id) { Array.prototype.forEach.call(doc.querySelectorAll('[data-price="' + id + '"]'), function (el) { if (typeof OJj[id] === 'number') el.textContent = (caOrder() ? 'US' : '') + money(OJj[id]); }); });
    if (OJj.ships_within) $('rp-ships').textContent = OJj.ships_within;
    $('rp-arrive').textContent = arr;
    $('rp-arrive').hidden = !arr;
    syncXmas();
  }
  var MADE_BY = { print: 'Made by Sig Lindquist in Chetek, Wisconsin. Your proof comes from sig@farmers1st.com, your receipt from Stripe.',
    file: 'Made by Sig Lindquist in Chetek, Wisconsin. Your file comes from sig@farmers1st.com, your receipt from Stripe.' };
  // why an order can't go yet, in words, or ''
  function orderBlock() {
    if (staleInputs()) return staleWords();
    // a logo still saving has no id yet, and one that didn't load isn't on the print
    if (LOGO && LOGO.state === 'saving') return 'The logo is still saving. Tap again in a moment.';
    if (ST.logo && LOGO && LOGO.state === 'missing') return 'The logo didn\u2019t load, so it isn\u2019t on the print. Remove it or choose the file again, then order.';
    // the usual-year line, the station history or the temperatures failed to load: the order would go without them
    var lost = loadFail();
    if (lost) return lost + ' Press Draw again, then order.';
    return '';
  }
  // the note under the step 3 button
  function buyNote(t) { var n = $('rp-buy-note'); n.textContent = t || ''; if (t) noteInView(n); return n; }
  /* "Check it and pay" (step 3, and the bar on a phone). It never pays: it
     opens the review sheet, whose own button does. */
  function checkIt() {
    flushRedraw();
    endExample();
    $('rp-noname').hidden = true;
    if (!canOrder()) {
      // Nothing of the reader's is drawn yet (the sample, or an empty box): send them to the town box.
      if (BLOCKED) return;
      try { $('rp-form').scrollIntoView({ behavior: smooth(), block: 'center' }); } catch (err) {}
      try { $('rp-place').focus({ preventScroll: true }); } catch (err) {}
      statusEl.textContent = 'Type the town nearest the farm and press Draw my year. The order carries the print you draw.';
      statusEl.classList.remove('rp-bad');
      return;
    }
    var why = orderBlock();
    if (why) { buyNote(why); return; }
    // every day's message shows now (each day in use counts as left); a day that can't go on the print as it is stops here, at its row
    dayNums().forEach(function (i) { if (rowUsed(i)) TOUCHED[i] = true; }); syncDates();
    var br = badRow();
    if (br) {
      buyNote('Day ' + br + ' isn\u2019t ready for the print. Fix it or remove it, then check again.');
      var f = $('rp-m' + br + 'mo').getAttribute('aria-invalid') === 'true' ? 'mo' : 'dy';
      try { $('rp-m' + br + f).focus(); } catch (err) {}
      return;
    }
    buyNote('');
    if (GIFT && GIFT.usable) { useGift(); return; }
    // no name on it: ask once (2026-10-14: the fastest way to checkout left a gift's name off)
    if (!ST.name && !NONAME_OK) {
      $('rp-noname').hidden = false;
      noteInView($('rp-noname'));
      try { $('rp-noname-add').focus({ preventScroll: true }); } catch (err) {}
      return;
    }
    openProof(true);
  }
  function goTo(u) { try { root.location.assign(u); } catch (err) { root.location.href = u; } }
  /* The order record (orderRecord above) goes to the subs worker before
     Stripe opens. Fail-soft: whatever the worker answers, or after
     PRESS_WAIT_MS with no answer, checkout opens anyway. */
  var ORDER_URL = 'https://agsist-subs.dnilgis.workers.dev/rp-order', PRESS_WAIT_MS = 2000, PRESS_BUSY = false;
  function pressPost(rec) {
    return new Promise(function (done) {
      var t = root.setTimeout(done, PRESS_WAIT_MS), end = function () { root.clearTimeout(t); done(); };
      try {
        root.fetch(ORDER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) }).then(end, end);
      } catch (e) { end(); }
    });
  }
  /* What the buyer ordered, kept in this tab (and this browser) for the page
     Stripe sends them back to, and for Back. The design is in the address bar
     too. Nothing leaves the browser. */
  var SAVE_KEY = 'agsist-rp-checkout';
  /* Every press is kept in this browser too (PRESS_KEY, the last ten in a
     week), so the page Stripe sends back to can tell whether it knows which
     design was paid for: this tab's own press, or the only recent one. */
  var PRESS_KEY = 'agsist-rp-presses', RECENT_MS = 2 * 3600000;
  function saveCheckout(id) {
    var o = { code: encodeCode(ST), choice: id, place: META ? META.place : ST.place, year: ST.year, gift: !!ST.gift, settle: !!SETTLE, t: Date.now() }, v = JSON.stringify(o);
    try { root.sessionStorage.setItem(SAVE_KEY, v); } catch (e) {}
    try { root.localStorage.setItem(SAVE_KEY, v); } catch (e) {}
    try { root.localStorage.setItem(PRESS_KEY, JSON.stringify(presses().concat([o]).slice(-10))); } catch (e) {}
  }
  function presses() {
    var a = null;
    try { a = JSON.parse(root.localStorage.getItem(PRESS_KEY) || '[]'); } catch (e) { a = []; }
    return (Array.isArray(a) ? a : []).filter(function (x) { return x && typeof x.code === 'string' && Date.now() - (x.t || 0) < 7 * 86400000; });
  }
  /* The design a paid= visit is about, or null when the page can't be sure:
     this tab's own press (sessionStorage), else the one press in this browser
     in the last two hours, when there is exactly one (2026-10-15: another
     tab's design was named on the thank-you). */
  function paidSaved() {
    var v = null;
    try { v = JSON.parse(root.sessionStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { v = null; }
    if (v && typeof v.code === 'string' && Date.now() - (v.t || 0) < 7 * 86400000) return v;
    var recent = presses().filter(function (x) { return Date.now() - x.t < RECENT_MS; });
    return recent.length === 1 ? recent[0] : null;
  }
  // a press for this very design within the hour, and no thank-you seen: maybe the way back from Stripe was lost
  function syncPaidHint() {
    var el = $('rp-paid-hint');
    if (!el) return;
    var code = DATA && !SAMPLE ? encodeCode(ST) : '';
    var hit = !PAID && code && presses().some(function (x) { return x.code === code && Date.now() - x.t < 3600000; });
    el.textContent = hit ? 'Already paid? Check your email for the Stripe receipt.' : '';
    el.hidden = !hit;
  }
  function savedCheckout() {
    var v = null;
    try { v = root.sessionStorage.getItem(SAVE_KEY); } catch (e) {}
    if (!v) try { v = root.localStorage.getItem(SAVE_KEY); } catch (e) {}
    try { v = v ? JSON.parse(v) : null; } catch (e) { v = null; }
    // a week old or more: not this order
    return v && typeof v.code === 'string' && Date.now() - (v.t || 0) < 7 * 86400000 ? v : null;
  }
  /* "Paid. Thank you." at the top of the page Stripe sends the buyer back to:
     what was ordered, when the proof or the file comes, when it ships, a way to
     make another. The address bar loses paid= and s= (a reload or a share
     shows no thank-you), and Analytics gets one purchase per checkout session. */
  var PAID_FIRED = false;
  /* A second gift (2026-10-19, board B: "order one, then the next" lost the second). Stripe Payment Links sell one
     design per checkout, so the next one is one tap: the same town, year, station and style, the words cleared
     (the name, the line under it, the marked days, who it's for and the note), the name box ready to type. */
  function anotherForSomeone(from, choice) {
    var s = readInputs(ST.year);
    s.place = ST.place; s.year = ST.year; s.station = ST.station;
    s.name = ''; s.dedication = ''; s.markers = [];
    writeInputs(s);
    ['rp-pg-to', 'rp-pg-msg', 'rp-gift-to', 'rp-gift-msg', 'ro-gift-to', 'ro-gift-msg', 'ro-gift-email', 'rp-pg-email'].forEach(function (id) { var el = $(id); if (el) el.value = ''; });
    restyle();
    ga('rain_print_another_person', { from: from, choice: choice || PICK });
    try { $('rp-design').scrollIntoView({ behavior: smooth(), block: 'start' }); } catch (e) {}
    try { $('rp-name').focus({ preventScroll: true }); } catch (e) {}
  }
  function showPaid(p, sv, fire) {
    var box = $('rp-paid'), lines = paidText({ choice: p.choice, today: TODAY, prices: PRICES, saved: sv });
    box.innerHTML = '<h2>Paid. Thank you.</h2>' + lines.map(function (t) { return '<p>' + esc(t).replace('sig@farmers1st.com', '<a href="mailto:sig@farmers1st.com">sig@farmers1st.com</a>') + '</p>'; }).join('') +
      // more than one (2026-10-16): one for each of the kids, or the home farm and the rented ground
      '<p>One for each of the kids, or for the home farm and the rented ground? Each is its own order, with its own proof.</p>' +
      (sv ? '<p><button type="button" class="btn btn-primary rp-paid-other" id="rp-paid-other">Make another for someone else</button></p>' : '') +
      '<p>' + (sv ? '<button type="button" class="rp-linkbtn" id="rp-paid-again">Same words, another town or year</button> or ' : '') + '<a href="/rain-print" id="rp-paid-new">Make another</a></p>';
    box.hidden = false;
    if (sv) $('rp-paid-other').addEventListener('click', function () { anotherForSomeone('paid', p.choice); });
    if (sv) $('rp-paid-again').addEventListener('click', function () {
      ga('rain_print_again', { choice: p.choice });
      try { $('rp-where').scrollIntoView({ behavior: smooth(), block: 'start' }); } catch (e) {}
      try { $('rp-year').focus({ preventScroll: true }); } catch (e) {}
    });
    $('rp-paid-new').addEventListener('click', function () { ga('rain_print_again', { choice: p.choice, fresh: 1 }); });
    try { box.focus({ preventScroll: true }); root.scrollTo(0, 0); } catch (e) {}
    var q = new URLSearchParams(root.location.search); q.delete('paid'); q.delete('s');
    try { root.history.replaceState(null, '', root.location.pathname + (String(q) ? '?' + q : '')); } catch (e) {}
    var key = 'agsist-rp-paid-' + p.session, seen = false;
    try { seen = !!root.localStorage.getItem(key); } catch (e) {}
    if (fire && p.session && !seen && !PAID_FIRED) {
      PAID_FIRED = true;
      try { root.localStorage.setItem(key, '1'); } catch (e) {}
      var J = PRICES || {}, v = typeof J[p.choice] === 'number' ? J[p.choice] : undefined;
      try { if (typeof root.gtag === 'function') root.gtag('event', 'purchase', { transaction_id: p.session, currency: 'USD', value: v, items: [{ item_id: p.choice, item_name: 'Rain Print, ' + CHOICE[p.choice], price: v, quantity: 1 }] }); } catch (e) {}
    }
  }
  // the review sheet's message line: a reason, or "Opening checkout"
  function proofSay(t, go) {
    var m = $('rp-proof-msg');
    if (go) m.innerHTML = t; else m.textContent = t || '';
    m.classList.toggle('rp-go', !!go);
    m.hidden = !t;
  }
  /* The review sheet's button: pays for what is shown, as picked. A design
     past Stripe's 200 characters goes to checkout as its short-link id
     (RPS-<id>), made now, at the press, once (never on a redraw). If the link
     service fails, or a product has no payment link, the order form takes the
     order with the full design code. */
  function pay(opts) {
    var id = PICK;
    proofSay('');
    if (!canOrder()) { closeProof(true); checkIt(); return; }
    var why = orderBlock();
    if (why) { proofSay(why); return; }
    if (!$('rp-proof-ok').checked) {
      proofSay('Tick the box once the spelling and the dates are right.');
      try { $('rp-proof-ok').focus(); } catch (err) {}
      return;
    }
    if (GIFT && GIFT.usable) { closeProof(true); useGift(); return; }
    var gift = pgOn();
    if (gift) {
      var chk = pgOrder('');
      if (chk.bad) { proofSay(chk.bad[1]); try { $(chk.bad[0]).focus(); } catch (err) {} return; }
    }
    var link = payLink(id), long = encodeCode(ST).length > 200;
    /* A design past Stripe's 200 letters goes as its short-link id, and the
       id is asked of the worker at this press every time, never taken from
       this browser's memory alone: an id the worker doesn't have would leave
       Sig an order he can't open (2026-10-15). */
    if (link && long && !(opts && opts.minted) && root.AgRpShort && root.AgRpShort.mint) {
      proofSay('Opening checkout\u2026', true);
      root.AgRpShort.mint(encodeCode(artDesign()), { fresh: true }).then(function (hit) { pay({ minted: true, ok: !!hit }); });
      return;
    }
    var code = link && long && !(opts && opts.ok) ? '' : refFor();
    // a gift goes to Sig first, then to checkout; if it can't be saved, the buyer stays here and is told
    if (gift && link && code && !(opts && opts.giftSent)) {
      var g = pgOrder(code).x, send = root.agsistFormPost;
      var fs = Object.assign({ _subject: orderSubject(g) + ' (paying at checkout)', _replyto: g.email, form: 'rain-print-order' }, g);
      var btn = $('rp-proof-order');
      proofSay('Saving the gift details\u2026', true);
      btn.disabled = true;
      (send ? send('rain-print-order', g, fs) : Promise.reject(new Error('no form helper'))).then(function () {
        btn.disabled = false;
        pay({ minted: opts && opts.minted, ok: opts && opts.ok, giftSent: true });
      }, function () {
        btn.disabled = false;
        ga('rain_print_gift_save', { result: 'fail', choice: id });
        var u = link + (link.indexOf('?') >= 0 ? '&' : '?') + 'client_reference_id=' + code;
        proofSay('The gift details didn\u2019t save just now. Tap Pay to try again, or <a href="' + esc(u) + '">go to checkout</a> and write their name and your note to ' + ORDER_TO + '.', true);
      });
      return;
    }
    ga('rain_print_buy', { choice: id, via: link && code ? 'checkout' : 'form', gift: ST.gift ? 1 : gift ? 2 : 0 });
    // Stripe's client_reference_id takes A-Z a-z 0-9 - _ and at most 200 characters: the design code, or its short-link id when the code is longer
    if (link && code) {
      var u = link + (link.indexOf('?') >= 0 ? '&' : '?') + 'client_reference_id=' + code;
      BUY_NOTE_CODE = encodeCode(ST);
      saveCheckout(id);
      flushRedraw();
      updateUrlNow();
      // the same tab: a link to tap in case the browser holds it back (an in-app browser); no design code in the words, it travels with the payment
      proofSay('Opening checkout\u2026 If nothing happens, <a href="' + esc(u) + '">go to checkout</a>.' + (shortRef() ? ' Your design reference: ' + esc(shortRef()) + '.' : ''), true);
      // one order record per press, then Stripe; a second tap while it goes counts once
      if (PRESS_BUSY) return;
      PRESS_BUSY = true;
      var J = OJ().j || {};
      pressPost(orderRecord(ST, code, id, typeof J[id] === 'number' ? J[id] : null)).then(function () { PRESS_BUSY = false; goTo(u); });
      return;
    }
    closeProof(true);
    // a checkout link that couldn't open (the short link didn't answer): say so, and offer it again
    openOrder(id, link ? 'Checkout couldn\u2019t open just now, so send this and I\u2019ll email you a payment link.' : '');
  }
  // the town or year in the boxes is not the one drawn
  function staleInputs() { var n = readInputs(); return !!ST.place && (n.year !== ST.year || n.place !== ST.place); }
  function staleWords() {
    return 'You changed the ' + (readInputs().year !== ST.year ? 'year' : 'town') + ' but haven\u2019t drawn it. Press Draw my year first, so you order what you see.';
  }
  function noteInView(note) {
    try {
      var r = note.getBoundingClientRect(), h = root.innerHeight || doc.documentElement.clientHeight;
      if (r.top < 0 || r.bottom > h) note.scrollIntoView({ behavior: smooth(), block: 'center' });
    } catch (err) {}
  }
  /* The line by the print while it isn't the one in the boxes: a draw on its
     way, or a town typed and not drawn (2026-10-14: a changed year or town
     left the print stale without a word). */
  function syncPending() {
    var el = $('rp-pending');
    if (!el) return;
    var n = readInputs(), t = '';
    // a design link's own first draw says nothing here: the headline under the print would jump for a moment
    if (DRAWING && DATA && ST.place && ST.year) t = FROM_LINK && !SHARED_SEEN ? '' : 'Drawing ' + ST.place + ', ' + ST.year + '\u2026';
    else if (n.place && ((SAMPLE && n.place) || (!SAMPLE && ST.place && (n.place !== ST.place || n.year !== ST.year)))) t = 'Not drawn yet: ' + n.place + ', ' + (n.year || '') + '. Press Draw my year.';
    el.textContent = t;
    el.hidden = !t;
    if (FROM_LINK && !DRAWING && DATA) SHARED_SEEN = true;
  }
  /* PHONE: the bar at the bottom ("Framed · $89 · Check it and pay") once the
     reader's own print is up, hidden while the step 3 button is on screen, a
     box has the keyboard, or the review sheet is open. The slim copy of the
     print pins under the menu once the big one scrolls away, and the page keeps
     a focused box below it. Laptops have neither (the print and the pay button
     are sticky in their columns). */
  var PAY_SEEN = false, TYPING = false, MINI_DIRTY = true;
  function navBottom() { var n = doc.querySelector('.nav'); var b = n ? n.getBoundingClientRect().bottom : 0; return b > 0 ? b : 0; }
  function phone() { return (root.innerWidth || 1000) < 900; }
  /* A DESIGN LINK OPENS WITH ITS PRINT FIRST (Sig, 2026-10-19). The early
     script in rain-print.html's head marks <html> rp-from-link for a ?d= link
     (/r?<id>, GIFT- and RPS- links all arrive as one), so the print sits at the
     top from the first paint. This names that print in the line over it (place
     and year from the design, and its name when it has one: what the print
     itself shows) and takes the mark off when the link can't be drawn. Once the
     reader draws another town, year or name, the line says so and links back. */
  var FROM_LINK = doc.documentElement.classList.contains('rp-from-link'), SHARED = null, SHARED_SEEN = false, SHARED_URL = root.location.href;
  function sharedOff() {
    if (!FROM_LINK) return;
    FROM_LINK = false;
    doc.documentElement.classList.remove('rp-from-link');
  }
  function sharedSet(s) {
    if (!FROM_LINK || !s || !s.place || !s.year) return;
    SHARED = { place: s.place, year: s.year, name: s.name || '' };
    syncShared();
  }
  function syncShared() {
    if (!FROM_LINK || !SHARED) return;
    var same = ST.place === SHARED.place && ST.year === SHARED.year && (ST.name || '') === SHARED.name;
    // the place and year first: a long name is what the two lines cut short
    var what = esc(SHARED.place + ', ' + SHARED.year), nm = SHARED.name ? ' (' + esc(SHARED.name) + ')' : '';
    var t = $('rp-shared-t'), h = same ? 'Shared with you: <b>' + what + '</b>' + nm : 'Shared with you: <a href="' + esc(SHARED_URL) + '">' + what + '</a>' + nm + '. The print here is yours now.';
    if (t.innerHTML !== h) t.innerHTML = h;
    $('rp-shared-own').hidden = !same;
  }
  function syncBar() {
    syncShared();
    var bar = $('rp-bar');
    if (!bar) return;
    // just paid for this very design: no bar asking to pay for it again (it comes back once anything changes)
    var paidFor = typeof PAID_SAVED !== 'undefined' && PAID_SAVED && PAID_SAVED.code === encodeCode(ST);
    var on = phone() && canOrder() && !SHOW_EX && !paidFor && !PAY_SEEN && !TYPING && !$('rp-proof').open && !(GIFT && GIFT.usable) && $('rp-order').hidden;
    if (on) $('rp-bar-where').textContent = (META ? META.place : ST.place) + ' ' + ST.year;
    bar.hidden = !on;
    // the room under the page for the bar, also on phones too old for :has() (iOS before 15.4)
    try { doc.body.classList.toggle('rp-bar-on', on); } catch (e) {}
  }
  // the pinned copy is redrawn only while it shows, when the page is idle
  var MINI_T = 0;
  function miniSoon() {
    if (MINI_T) return;
    var go = function () { MINI_T = 0; if (!MINI_DIRTY || $('rp-strip').hidden || !DATA) return; $('rp-mini').innerHTML = '<span class="rp-mini-in">' + buildSvg({ idPrefix: 'mn', example: SHOW_EX }) + '</span>'; MINI_DIRTY = false; };
    MINI_T = root.requestIdleCallback ? root.requestIdleCallback(go, { timeout: 600 }) : setTimeout(go, 200);
  }
  function syncStrip() {
    var st = $('rp-strip');
    if (!st) return;
    var nav = navBottom(), on = false;
    doc.documentElement.style.setProperty('--rp-nav', Math.round(nav || 64) + 'px');
    if (phone() && DATA && !BLOCKED && !$('rp-proof').open) {
      var w = $('rp-wall').getBoundingClientRect(), col = $('rp-stepcol').getBoundingClientRect();
      on = w.bottom < nav + 8 && col.bottom > nav + 200;
      // a design link: the headline and photo sit between the print and the steps, no pinned copy over them
      if (on && FROM_LINK) on = col.top < (root.innerHeight || 0);
    }
    if (on && MINI_DIRTY) miniSoon();
    if (on) $('rp-strip-t').textContent = (META ? META.place : ST.place) + ', ' + ST.year;
    if (st.hidden === on) {
      st.hidden = !on;
      doc.documentElement.style.scrollPaddingTop = on ? Math.round(nav + st.offsetHeight + 12) + 'px' : '';
    }
  }
  /* A box the reader just put the keyboard in never sits under the pinned
     copy. Only from the focus handler, never from the scroll: the town box
     keeps focus after Draw, and pulling the page back up to it whenever the
     pinned copy showed trapped a phone at step 1 (2026-10-15). A box already
     scrolled past (fully above the pinned copy) is left alone. */
  function keepFocusClear() {
    var st = $('rp-strip'), a = doc.activeElement;
    if (!st || st.hidden || !a || !/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    var sr = st.getBoundingClientRect(), lim = sr.bottom + 8, r = a.getBoundingClientRect();
    if (r.bottom <= sr.top + 4) return;
    if (r.top < lim) try { root.scrollBy(0, r.top - lim - 4); } catch (e) {}
  }
  function shortHit() { return root.AgRpShort ? root.AgRpShort.peek(encodeCode(artDesign())) : null; }
  function shortRef() { var m = /\/R\?([0-9A-Z]{5,8})$/.exec(shortHit() || ''); return m ? 'RPS-' + m[1] : ''; }
  function refFor() { return checkoutRef(encodeCode(ST), ST.gift, shortHit()); }
  // the design code the order form sends: the code itself, or the short-link reference when the code is past the worker's 300
  function orderCode() { var c = encodeCode(ST); return c.length <= 300 ? c : (checkoutRef(c, ST.gift, shortHit()) || c); }
  /* The order summary at the top of the order form: what is ordered, the
     design in words, and exactly what happens next. Payment links are null
     today, so every order is a request Sig answers by email. */
  function markerWords(m) {
    var c = linkCut(m), t = c ? null : typedCut(m);
    return shortDate(m.date) + (m.label ? ' \u201c' + m.label + '\u201d' : '') + (c ? ' (cut off: only ' + LIMITS.label + ' letters fit, the link had \u201c' + c.full + '\u201d)'
      : t ? ' (cut off: only ' + LIMITS.label + ' letters fit, you typed \u201c' + t + '\u201d)' : '');
  }
  function designRows() {
    var rows = [['Place and year', (META ? META.place : ST.place) + ', ' + ST.year], ['Style', ST.style === 'r2' ? 'Roots' : 'Staircase'],
      ['Name', (ST.name || '(none)') + cutWords('rp-name', LIMITS.name)], ['Line under it', (ST.dedication || '(none)') + cutWords('rp-ded', LIMITS.dedication)]];
    rows.push(['Marked days', ST.markers.length ? ST.markers.map(markerWords).join(', ') : '(none)']);
    if (ST.logo || (LOGO && LOGO.state === 'saving')) rows.push(['Logo', logoWords()]);
    if (META) rows.push(['Weather station', gaugeWords(META) + ', ' + distText(META)]);
    rows.push(['Compared with', ST.cmp === 'normal' ? 'NOAA 30-year normal' : ST.cmp === 'station' ? 'The station\u2019s full record' : 'Nothing']);
    // the 2026-10-17 options, so the proof and the order say exactly what prints
    if (ST.crop) rows.push(['Crop', ({ corn: 'Corn', soy: 'Soybeans' })[ST.crop] + ', planted ' + shortDate(ST.cropPlant) + ', harvested ' + shortDate(ST.cropHarvest) +
      (ST.plants ? ', with plant drawings' : ', stages labeled') + (ST.ghost ? ', against a usual year' : '')]);
    var tw = [];
    if (ST.frost) tw.push('frost marks'); if (ST.heat) tw.push('hottest and coldest day'); if (ST.ribbon) tw.push('daily temperature band');
    if (tw.length) rows.push(['Temperatures', tw.join(', ') + (TEMP && TEMP.tm ? '; from ' + (TEMP.tm.same ? 'the same station' : TEMP.tm.name + ', ' + TEMP.tm.words) : '')]);
    if (ST.hist) rows.push(['Every year behind', ST.style === 'r2' ? 'on, but Roots doesn\u2019t draw it' : 'on' + (META && FULL_CACHE.get(META.sid) ? ', ' + FULL_CACHE.get(META.sid).length + ' full years at this station' : '')]);
    return rows;
  }
  function logoWords() {
    if (!LOGO || LOGO.state === 'missing') return 'added, but it didn\u2019t load here; I\u2019ll check it in your proof';
    if (LOGO.state === 'saving') return 'still saving';
    return 'added, ' + (ST.logoInk ? 'in the print\u2019s ink color' : 'in its own colors');
  }
  function syncSummary() {
    var el = $('ro-summary'), id = $('ro-choice').value, J = OJ().j || {};
    if (!el || !canOrder()) { if (el) el.innerHTML = ''; return; }
    var paid = !!(GIFT && GIFT.usable);   // a gift card: already paid for (2026-10-13: the form asked a card holder to pay)
    var price = paid ? 'covered by your gift card' : typeof J[id] === 'number' ? money(J[id]) + (id === 'digital' ? '' : ', shipping included') : '';
    var jan = januaryGift() || (SETTLE && canOrder()), print = id !== 'digital';
    var whenIn = januaryGift() ? 'In January, once the full year is in' : 'Once the full year is in';
    var steps = !print ? (paid
      ? ['The finished file comes by email within 1 business day.', 'Want anything changed? Write to me and I\u2019ll fix it or redo it by hand and send it again, no charge.']
      : jan
      ? ['I email you within 1 business day with a payment link. Nothing\u2019s charged until you pay it.', whenIn + ', I draw it and email you the finished file.', 'Want anything changed? Write to me and I\u2019ll fix it or redo it by hand and send it again, no charge.']
      : ['I email you within 1 business day with a payment link. Nothing\u2019s charged until you pay it.', 'The finished file comes by email within 1 business day of paying. There\u2019s no proof step for the file.', 'Want anything changed? Write to me and I\u2019ll fix it or redo it by hand and send it again, no charge.'])
      : paid
      ? ['I email you a proof of this exact design within 1 business day.', 'You OK the proof or ask for changes. Nothing prints before you OK it.', 'It ships within ' + (J.ship_business_days || 3) + ' business days after you OK the proof.']
      : jan
      ? ['I email you within 1 business day with a payment link. Nothing\u2019s charged until you pay it.', whenIn + ', I draw it and email you the proof.', 'You OK the proof or ask for changes. Nothing prints before that.', 'It ships within ' + (J.ship_business_days || 3) + ' business days after you OK it.']
      : ['I email you a proof of this exact design within 1 business day, with a payment link.', 'You OK the proof or ask for changes. Nothing is charged until you pay the link, and nothing prints before you OK it.',
        'It ships within ' + (J.ship_business_days || 3) + ' business days after you OK the proof.'];
    el.innerHTML = '<p><b>' + esc(CHOICE[id]) + (price ? ', ' + esc(price) : '') + '</b>' + (PROOF_OK === encodeCode(ST) ? ' &middot; you checked the proof' : ' &middot; <a href="#rp-proof" id="ro-see-proof">' + (print ? 'check the proof first' : 'check it up close first') + '</a>') + '</p>' +
      '<dl>' + designRows().map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      '<p><b>What happens next</b></p><ol>' + steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';
    var sp = $('ro-see-proof');
    if (sp) sp.addEventListener('click', function (ev) { ev.preventDefault(); openProof(); });
  }

  // ---------- "Your print": the exact print file, fitted or at actual size ----------
  /* Rebuilt 2026-10-14 (Sig: "all scrunched and very hard to see"): the print
     fills the window, one panel beside it (under it on a phone) holds the order
     button, Style and Look, and the details in words. The magnifier toggles Fit
     and actual size; at actual size, drag or scroll to move; Esc goes back to Fit. */
  var PROOF_OK = '', PROOF_VIEW = 'print', PROOF_ZOOM = 'fit', PROOF_FROM = null, PROOF_HANDOFF = false;
  function proofZoomSync() {
    var dlg = $('rp-proof'), full = PROOF_ZOOM === 'full', z = $('rp-proof-zoom');
    dlg.setAttribute('data-zoom', PROOF_ZOOM);
    z.setAttribute('aria-pressed', String(full));
    z.setAttribute('aria-label', full ? 'Fit the print to the window' : 'See it at actual size');
    $('rp-proof-zoom-t').textContent = full ? 'Fit' : 'Actual size';
    $('rp-proof-stage').setAttribute('aria-label', 'The print' + (full ? ', at actual size. Drag or use the arrow keys to move around.' : '. ') + ' ' + proofAlt());
  }
  // the print in words, for a screen reader: the same details the panel lists
  function proofAlt() {
    return designRows().filter(function (r) { return r[0] !== 'Style'; }).map(function (r) { return r[0] + ': ' + r[1]; }).join('. ') + '.';
  }
  function proofRender() {
    var dlg = $('rp-proof');
    if (!DATA || BLOCKED) { dlg.close && dlg.open && dlg.close(); return; }
    PROOF_VIEW = PICK === 'framed12x18' ? 'framed' : 'print';
    $('rp-proof-art').innerHTML = buildSvg({ idPrefix: 'pf', serial: SERIAL });
    var svg = $('rp-proof-art').querySelector('svg');
    if (svg) svg.setAttribute('aria-hidden', 'true');   // the stage around it carries the words
    dlg.setAttribute('data-view', PROOF_VIEW);
    radios('rp-pproduct').forEach(function (r) { r.checked = r.value === PICK; });
    proofZoomSync();
    // the details: label above value, in the order a buyer checks them
    var rows = {}; designRows().forEach(function (r) { rows[r[0]] = r[1]; });
    var list = [['Place and year', esc(rows['Place and year'])]];
    if (rows['Weather station']) list.push(['Weather station', esc(rows['Weather station'])]);
    var cutSpan = function (id, v) { return textCut(id) ? '<span class="rp-pd rp-pcut">' + esc(v) + '</span>' : esc(v); };
    list.push(['Name', cutSpan('rp-name', rows['Name'])], ['Line under it', cutSpan('rp-ded', rows['Line under it'])],
      ['Marked days', ST.markers.length ? ST.markers.map(function (m) { return '<span class="rp-pd' + (linkCut(m) || typedCut(m) ? ' rp-pcut' : '') + '">' + esc(markerWords(m)) + '</span>'; }).join('') : '(none)'],
      ['Compared with', esc(rows['Compared with'])], ['Style', esc(rows['Style'])]);
    ['Crop', 'Temperatures', 'Every year behind'].forEach(function (k) { if (rows[k]) list.push([k, esc(rows[k])]); });
    // the logo, in words and as it prints
    if (rows['Logo']) { var la = logoArt(); list.push(['Logo', esc(rows['Logo']) + (la ? '<img class="rp-plogo" alt="" src="' + esc(la.href) + '">' : '')]); }
    if (PREVIEW) list.push(['Preview', 'through ' + esc(longDate(PREVIEW.last)) + '; the print shows the full year']);
    var can = canOrder(), gift = !!(GIFT && GIFT.usable), p = pickPrice(PICK);
    // what the picker above it doesn't say: when it comes (and that a gift card covers it)
    if (can) list.push(['When', esc((gift ? 'Covered by your gift card. ' : '') + whenWords(PICK) + ' ' + MADE_BY[PICK === 'digital' ? 'file' : 'print'])]);
    $('rp-proof-sum').innerHTML = list.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd></div>'; }).join('');
    $('rp-proof-ok').checked = PROOF_OK === encodeCode(ST);
    // the one action: pay for what is shown, as picked
    $('rp-proof-order').textContent = !can ? 'Draw your own' : gift ? 'Use my gift' : payLink(PICK) ? 'Pay' + (p ? ' ' + p : '') + ' at checkout' : 'Order it' + (p ? ', ' + p : '');
    $('rp-proof-first').textContent = !can ? 'This is a sample. Type the town nearest the farm to draw your own.'
      : gift && GIFT.product === 'digital' ? 'Your card covers the digital file.'
      : PICK === 'digital' ? 'No proof for the file: it comes finished. Want a change after? Write to me and I\u2019ll redo it.'
      : 'You see a proof first, and get a full refund any time before I print.';
    $('rp-proof-ok-wrap').hidden = !can;
    var when = can && !gift ? payWhen(PICK, TODAY) : '';
    $('rp-proof-when').textContent = when;
    $('rp-proof-when').hidden = !when;
    pgSync();
  }
  /* RIGHT ABOVE PAY (2026-10-17, panels): who the next email comes from and
     when, so a proof from a farmers1st.com address isn't taken for spam, and a
     design of this year says it arrives in January before anyone pays. The
     Christmas date on each card holds only if the proof is OK'd the day it
     comes; this says what happens when it isn't. */
  function payWhen(id, today) {
    if (januaryGift()) return 'Arrives in January, once the year is done. A gift card for under the tree comes by email within 1 business day.';
    var J = OJ().j || {}, hol = holidaysFor(J, today), next = addBizDays(today, 1, hol);
    var by = next === isoMinusDays(today, -1) ? 'tomorrow' : 'by ' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(next + 'T12:00:00Z').getUTCDay()];
    if (id === 'digital') return 'The finished file comes by email from Sig at ' + ORDER_TO + ' within 1 business day. Check spam if it\u2019s not there ' + (by === 'tomorrow' ? 'by tomorrow' : by) + '.';
    var cut = cutoffNote(today, J[CUTOFF_KEY[id]]);
    return 'Watch for an email from Sig at ' + ORDER_TO + ' with your proof. Check spam if it\u2019s not there ' + (by === 'tomorrow' ? 'by tomorrow' : by) + '.' +
      (/^Order by/.test(cut) ? ' OK it late? I\u2019ll tell you the new date the same day.' : '');
  }
  /* THE GIFT ON THE REVIEW SHEET (2026-10-17, field audit). The last AGSIST
     screen before Stripe never said the print could be a gift, and the order
     form's own "It's a gift" box (#ro-isgift) only shows on the order-request
     path. Now the sheet has the tick and the fields. They mirror the order
     form's (PG_MIRROR), so a fall-back to the form keeps what was typed. With
     a payment link, Pay first posts the gift as a rain-print-order (gift: yes,
     the same fields an order request sends) for scripts/form_digest.py to mail
     Sig, whose note goes on the letter (rp-insert), then opens checkout. Not
     offered for an order a gift card pays for. This year's January gift
     (2026-10-18, Sig) uses the same box: its note is for the gift card, it
     posts gift_january instead of gift, and the step 3 boxes (#rp-gift-to,
     #rp-gift-msg) come onto it and stay in step with it. */
  var PG_MIRROR = { 'rp-pg-to': 'ro-gift-to', 'rp-pg-msg': 'ro-gift-msg', 'rp-pg-deliver': 'ro-deliver', 'rp-pg-email': 'ro-gift-email',
    'rp-pg-addr': 'ro-address', 'rp-pg-name': 'ro-name', 'rp-pg-me': 'ro-email' };
  function pgOffered() { return canOrder() && !(GIFT && GIFT.usable); }
  var PG_JAN = { 'rp-pg-to': 'rp-gift-to', 'rp-pg-msg': 'rp-gift-msg' };
  function pgOn() { return pgOffered() && $('rp-pg-on').checked; }
  function pgTheirs() { return $('rp-pg-deliver').value === 'recipient'; }
  function pgPull() {
    // what the order form already holds comes onto the sheet
    var jan = januaryGift();
    Object.keys(PG_MIRROR).forEach(function (k) { var v = $(jan && PG_JAN[k] || PG_MIRROR[k]).value; if (v && !$(k).value) $(k).value = v; });
    if (jan ? !!($('rp-gift-to').value.trim() || $('rp-gift-msg').value.trim()) : $('ro-isgift').checked) $('rp-pg-on').checked = true;
  }
  function pgSync() {
    var offered = pgOffered(), on = offered && $('rp-pg-on').checked, file = PICK === 'digital', theirs = pgTheirs();
    $('rp-pgift').hidden = !offered;
    $('rp-pg-box').hidden = !on;
    $('rp-pg-msg-l').textContent = januaryGift() ? 'A message for the gift card (optional)' : file ? 'Your note, sent with the file (optional)' : 'Your note, printed at the top of the letter in the box (optional)';
    /* The address is Stripe's (2026-10-19, board B: the same address typed twice on a phone was a quit point;
       Sig keeps Stripe's shipping field on, 2026-10-18). With a payment link the sheet asks no address and says
       where it goes; the order post says it is at checkout. Without one, the order form path, it is asked here. */
    var stripeShips = !file && !!payLink(PICK);
    $('rp-pg-addr-wrap').hidden = file || stripeShips;
    $('rp-pg-ship').hidden = !stripeShips;
    $('rp-pg-ship').textContent = 'Where it ships: at checkout, Stripe asks for the shipping address. Give ' + (theirs ? 'theirs.' : 'yours.');
    $('rp-pg-addr-l').textContent = (theirs ? 'Their address' : 'Your address') + ' (name, street, town, ' + (caOrder() ? 'province, postal code' : 'state, ZIP') + ')';
    $('rp-pg-email-wrap').hidden = !(file && theirs);
    $('rp-pg-me-l').textContent = file ? 'Your email' : 'Your email, for the proof';
    $('rp-pg-line').textContent = (file ? 'No prices go with it.' : 'No prices go in the box.') + ' These come to me with your order; at checkout, Stripe takes the payment.';
    var sum = $('rp-pg-sum');
    sum.hidden = !on;
    if (on) {
      var to = cleanText($('rp-pg-to').value, GIFT_TO_MAX), msg = $('rp-pg-msg').value.trim();
      sum.innerHTML = [['Gift for', to || '(say who it\u2019s for)'], [file ? 'Note with the file' : 'Note on the letter', msg || '(none)'],
        ['Goes to', theirs ? (to || 'them') : 'you']].map(function (r, i) { return i === 1 && januaryGift() ? ['Note on the gift card', r[1]] : r; }).map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
    }
  }
  // the gift as an order post, or {bad: [field id, words]}
  function pgOrder(ref) {
    var file = PICK === 'digital', theirs = pgTheirs(), stripeShips = !file && !!payLink(PICK);
    var x = {
      name: cleanText($('rp-pg-name').value, 80), email: $('rp-pg-me').value.trim(), choice: PICK,
      // the worker wants an address for a print (subs-worker formClean); with a payment link it is the one given at Stripe checkout
      address: file ? '' : stripeShips ? ('The shipping address given at Stripe checkout' + (ref ? ', reference ' + ref : '') + (theirs ? ' (theirs)' : ' (the buyer\u2019s)')).slice(0, 600)
        : $('rp-pg-addr').value.trim().slice(0, 600),
      design_url: designUrl(ST), design_code: orderCode(), page: '/rain-print',
      gift_to: cleanText($('rp-pg-to').value, GIFT_TO_MAX), gift_deliver: theirs ? 'recipient' : 'buyer',
      gift_email: file && theirs ? $('rp-pg-email').value.trim() : '',
      gift_message: $('rp-pg-msg').value.replace(/\r\n?/g, '\n').trim().slice(0, GIFT_MSG_MAX)
    };
    if (januaryGift()) x.gift_january = true; else x.gift = true;
    if (ST.logo) x.logo = ST.logo;
    // the worker keeps known fields only, so the checkout and the proof tick ride in the notes
    x.notes = ('Paying now at Stripe checkout' + (ref ? ', reference ' + ref : '') + '. Gift details from the review sheet; no payment link needed.' +
      (x.gift_january ? ' Make it after January 1, once the full year is in.' : '') +
      (PROOF_OK === encodeCode(ST) ? ' Proof checked on the page: yes.' : ' Proof checked on the page: no.')).slice(0, 2000);
    var bad = !x.gift_to ? ['rp-pg-to', 'Say who the gift is for, or untick \u201cThis is a gift\u201d.']
      : !file && !stripeShips && x.address.length < 10 ? ['rp-pg-addr', theirs ? 'Add their address for the print.' : 'Add your address for the print.']
      : file && theirs && !EMAIL_RE.test(x.gift_email) ? ['rp-pg-email', 'Add their email for the file, or choose Me under Send it to.']
      : !x.name ? ['rp-pg-name', 'Add your name.']
      : !EMAIL_RE.test(x.email) ? ['rp-pg-me', 'Add your email, so I can send you the proof.'] : null;
    return bad ? { bad: bad } : { x: x };
  }
  // when it comes, in words, for the review sheet
  function whenWords(id) {
    var file = id === 'digital', J = OJ().j || {};
    if (giftMode() && canOrder()) return 'This one is made in January, once the full year is in, and I send the ' + (file ? 'finished file' : 'proof') + ' then. Within 1 business day I email you a gift card to print.';
    if (SETTLE) return 'NOAA doesn\u2019t have all of ' + ST.year + ' in yet. I make this one once the full year is in, and send the ' + (file ? 'finished file' : 'proof') + ' then.';
    if (file) return 'A PNG and a PDF by email within 1 business day of paying.';
    return 'Shipping included. A proof by email within 1 business day; it ships within ' + (J.ship_business_days || 3) + ' business days of your OK. ' + cutoffNote(TODAY, J[CUTOFF_KEY[id]]);
  }
  /* Fit or actual size. Going in, the spot that was clicked (or the middle)
     stays under the pointer; coming out, back to the whole print. */
  function proofZoom(z, at) {
    if (z === PROOF_ZOOM) return;
    var st = $('rp-proof-stage'), art = $('rp-proof-art'), r = art.getBoundingClientRect();
    var fx = at && r.width ? Math.min(1, Math.max(0, (at.x - r.left) / r.width)) : 0.5,
      fy = at && r.height ? Math.min(1, Math.max(0, (at.y - r.top) / r.height)) : 0.5;
    PROOF_ZOOM = z;
    proofZoomSync();
    if (z === 'full') {
      var s = st.getBoundingClientRect(), a = art.getBoundingClientRect();
      var px = at ? at.x - s.left : s.width / 2, py = at ? at.y - s.top : s.height / 2;
      st.scrollLeft = a.left - s.left + st.scrollLeft + fx * a.width - px;
      st.scrollTop = a.top - s.top + st.scrollTop + fy * a.height - py;
    } else { st.scrollLeft = 0; st.scrollTop = 0; }
  }
  function openProof() {
    flushRedraw();
    if (!DATA || BLOCKED) return;
    var dlg = $('rp-proof');
    if (dlg.open) return;
    endExample();
    // one product state: the sheet shows what step 3 has picked (framed, or the print alone)
    PROOF_ZOOM = 'fit';
    proofSay('');
    PROOF_FROM = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : $('rp-zoom');
    PROOF_HANDOFF = false;
    pgPull();
    proofRender();
    try { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); } catch (e) { dlg.setAttribute('open', ''); }
    try { $('rp-proof-stage').scrollTop = 0; $('rp-proof-stage').scrollLeft = 0; dlg.scrollTop = 0; } catch (e) {}
    ga('rain_print_proof', { style: ST.style });
    syncBar(); syncStrip();
  }
  // close; focus goes back to what opened it, unless an order step takes it on
  function closeProof(handoff) {
    PROOF_HANDOFF = !!handoff;
    var dlg = $('rp-proof');
    if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  }
  var ORDER_NOTE_0 = '', SENT_CODE = '';
  function openOrder(id, why) {
    flushRedraw();
    var box = $('rp-order'), note = $('ro-order-note');
    if (!ORDER_NOTE_0) ORDER_NOTE_0 = note.innerHTML;
    if (why) note.textContent = why; else note.innerHTML = ORDER_NOTE_0;
    note.classList.toggle('rp-bad', !!why);
    $('ro-retry').hidden = !why;
    box.hidden = false;
    $('ro-choice').value = id;
    syncAddress();
    $('ro-design').value = designUrl(ST);
    // "Sent." stays for the design it was sent for: opening the form again for that design doesn't wipe it (2026-10-15)
    if (SENT_CODE !== encodeCode(ST)) { $('ro-out').innerHTML = ''; SENT_CODE = ''; }
    syncSummary();
    try { box.scrollIntoView({ behavior: smooth(), block: 'start' }); } catch (e) {}
    try { $('ro-name').focus({ preventScroll: true }); } catch (e) {}
  }
  /* "It's a gift" on an ordinary order (2026-10-12), a tick box over the price
     cards. Any finished year and any product; this year's January gift has its
     own box (#rp-gift), so the tick box is not offered then.
     A product WITH a Stripe Payment Link goes to the review sheet, whose gift
     box (#rp-pgift) takes who it's for, the note and the address before
     checkout (2026-10-18: nothing about the gift relies on Stripe).
     A product WITHOUT a link opens the order request form, which then shows
     who it's for, a note printed at the top of the letter in the box (no prices go in), and
     where it goes. Same gift_ fields, plus gift:true (worker v5.12). */
  function januaryGift() { return giftMode() && canOrder(); }
  function giftTicked() { return !januaryGift() && $('ro-isgift').checked; }
  function plainGift() { return giftTicked() && !payLink($('ro-choice').value); }
  function syncGiftCheckout() {
    var el = $('rp-gift-checkout'), linked = PRODUCTS.filter(function (id) { return payLink(id); });
    var t = '';
    if (giftTicked() && linked.length) {
      t = 'Before you pay, the next screen asks their name and your note.';
      if (linked.length < PRODUCTS.length) {
        var names = linked.map(function (id) { return CHOICE[id].replace(/^Digital/, 'digital'); });
        t = 'For the ' + names.join(' and the ') + ', y' + t.slice(1) + ' The others take your note on the order form.';
      }
    }
    el.textContent = t;
    el.hidden = !t;
  }
  function syncAddress() {
    var print = $('ro-choice').value !== 'digital', jan = januaryGift(), plain = plainGift();
    $('ro-address-wrap').hidden = !print;
    $('ro-address').required = print;
    $('rp-isgift-wrap').hidden = jan;
    syncGiftCheckout();
    $('ro-gift-box').hidden = !plain;
    $('ro-gift-line').textContent = print ? 'I print the note at the top of the letter in the box. No prices go in.'
      : 'I send the note with the file. No prices go with it.';
    $('ro-deliver-wrap').hidden = !(jan || plain);
    $('ro-notes').placeholder = jan || giftTicked() ? 'Need it by a certain day? Say so here.' : 'A gift? Need it by a certain day? Say so here.';
    var theirs = (jan || plain) && $('ro-deliver').value === 'recipient';
    var zip = caOrder() ? 'province, postal code' : 'state, ZIP';
    $('ro-address-label').textContent = jan ? 'Ship to (name, street, town, ' + zip + '; theirs is fine)'
      : plain && theirs ? 'Ship to them (their name, street, town, ' + zip + ')' : 'Ship to (name, street, town, ' + zip + ')';
    // a gift file sent straight to the person it is for needs their email
    var mail = theirs && !print;
    $('ro-gift-email-wrap').hidden = !mail;
    $('ro-gift-email').required = mail;
  }
  var EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;
  function orderSubject(x) {
    return 'Rain Print order' + (x.gift_january ? ' (' + ST.year + ' gift, January)' : x.gift ? ' (gift)' : '') + ': ' + CHOICE[x.choice] + ' for ' + x.name;
  }
  function orderText(x) {
    return orderSubject(x) + '\n\nName: ' + x.name + '\nEmail: ' + x.email +
      (x.gift_january || x.gift ? (x.gift_january ? '\nGift: yes, make it after January 1 once the full year is in' : '\nGift: yes, the note printed at the top of the letter in the box, no prices') +
        (x.gift_to ? '\nGift for: ' + x.gift_to : '') + '\nDeliver to: ' + (x.gift_deliver === 'recipient' ? 'the person it is for' : 'the buyer') +
        (x.gift_email ? '\nTheir email: ' + x.gift_email : '') + (x.gift_message ? '\nNote for the letter: ' + x.gift_message : '') : '') +
      (x.address ? '\nShip to:\n' + x.address : '') + (x.notes ? '\nNotes: ' + x.notes : '') +
      '\nDesign code: ' + x.design_code + '\nDesign: ' + x.design_url + (x.logo ? '\nLogo: ' + LOGO_LINK + x.logo : '') + '\n';
  }
  var LOGO_LINK = 'https://agsist-subs.dnilgis.workers.dev/rp-logo/';
  var sending = false;
  function submitOrder(e) {
    e.preventDefault();
    if (sending) return;
    var out = $('ro-out');
    if (!canOrder()) { out.innerHTML = '<p class="rp-msg rp-bad">Draw your print first.</p>'; return; }
    if (staleInputs()) { out.innerHTML = '<p class="rp-msg rp-bad">' + esc(staleWords()) + '</p>'; return; }
    if (LOGO && LOGO.state === 'saving') { out.innerHTML = '<p class="rp-msg rp-bad">The logo is still saving. Send again in a moment.</p>'; return; }
    if (ST.logo && LOGO && LOGO.state === 'missing') { out.innerHTML = '<p class="rp-msg rp-bad">The logo didn\u2019t load, so it isn\u2019t on the print. Remove it or choose the file again, then send.</p>'; return; }
    var x = {
      name: cleanText($('ro-name').value, 80), email: $('ro-email').value.trim(), choice: $('ro-choice').value,
      address: $('ro-address').value.trim().slice(0, 600), notes: $('ro-notes').value.trim().slice(0, 2000),
      design_url: designUrl(ST), design_code: orderCode(), page: '/rain-print'
    };
    if (ST.logo) x.logo = ST.logo;
    // the worker keeps known fields only, so the proof tick rides in the notes
    x.notes = ((PROOF_OK === encodeCode(ST) ? 'Proof checked on the page: yes.' : 'Proof checked on the page: no.') +
      (SETTLE ? ' NOAA didn\u2019t have all of ' + ST.year + ' in yet: make it once the full year is in.' : '') + (x.notes ? '\n' + x.notes : '')).slice(0, 2000);
    if (x.choice === 'digital') x.address = '';
    var gift = giftMode(), plain = plainGift();
    if (plain) {
      x.gift = true;
      x.gift_to = cleanText($('ro-gift-to').value, GIFT_TO_MAX);
      x.gift_deliver = $('ro-deliver').value === 'recipient' ? 'recipient' : 'buyer';
      x.gift_email = x.choice === 'digital' && x.gift_deliver === 'recipient' ? $('ro-gift-email').value.trim() : '';
      x.gift_message = $('ro-gift-msg').value.replace(/\r\n?/g, '\n').trim().slice(0, GIFT_MSG_MAX);
    }
    if (gift) {
      x.gift_january = true;
      x.gift_to = cleanText($('rp-gift-to').value, GIFT_TO_MAX);
      x.gift_deliver = $('ro-deliver').value === 'recipient' ? 'recipient' : 'buyer';
      x.gift_email = x.choice === 'digital' && x.gift_deliver === 'recipient' ? $('ro-gift-email').value.trim() : '';
      x.gift_message = $('rp-gift-msg').value.replace(/\r\n?/g, '\n').trim().slice(0, GIFT_MSG_MAX);
    }
    var bad = !x.name ? ['ro-name', 'Add your name.'] : !EMAIL_RE.test(x.email) ? ['ro-email', 'Add an email address I can reply to.']
      : (x.choice !== 'digital' && x.address.length < 10) ? ['ro-address', 'Add the shipping address for the print.']
      : (plain && !x.gift_to) ? ['ro-gift-to', 'Say who the gift is for, or untick \u201cIt\u2019s a gift\u201d.']
      : ((gift || plain) && x.choice === 'digital' && x.gift_deliver === 'recipient' && !EMAIL_RE.test(x.gift_email)) ? ['ro-gift-email', 'Add their email for the file, or choose Me under Deliver to.'] : null;
    if (bad) { out.innerHTML = '<p class="rp-msg rp-bad">' + esc(bad[1]) + '</p>'; try { $(bad[0]).focus(); } catch (err) {} return; }
    /* Past the worker's 300 characters the order carries the short-link
       reference: made now, once, at the press (never on a redraw). If the link
       service fails, the order still goes, with the full design code. */
    if (encodeCode(ST).length > 300 && !shortHit() && root.AgRpShort && root.AgRpShort.mint) {
      var wait = $('ro-submit'), wasW = wait.textContent;
      sending = true; wait.disabled = true; wait.textContent = 'Sending\u2026';
      root.AgRpShort.mint(encodeCode(artDesign())).then(function () {
        sending = false; wait.disabled = false; wait.textContent = wasW;
        x.design_code = orderCode();
        sendIt();
      });
      return;
    }
    sendIt();
    function sendIt() {
      var hp = form && doc.querySelector('#ro-form input[name="_gotcha"]');
      var data = Object.assign({ _gotcha: hp ? hp.value : '' }, x);
      var subj = orderSubject(x);
      var fs = Object.assign({ _subject: subj, _replyto: x.email, form: 'rain-print-order' }, x);
      if (hp && hp.value) fs._gotcha = hp.value;
      var btn = $('ro-submit'), was = btn.textContent;
      sending = true; btn.disabled = true; btn.textContent = 'Sending…'; out.innerHTML = '';
      if (GIFT && GIFT.usable && root.AgRpGift) {
        x.choice = GIFT.product;
        root.AgRpGift.redeem(GIFT, x).then(function (r) {
          ga('rain_print_gift_redeem', { result: r.ok ? 'ok' : 'fail' });
          out.innerHTML = r.ok ? root.AgRpGift.doneHtml(GIFT, r, x.choice || GIFT.product) : '<p class="rp-msg rp-bad">' + esc(r.error || 'That didn\u2019t go through. Try again, or write to ' + ORDER_TO + '.') + '</p>';
          if (r.ok) { $('ro-form').reset(); syncGiftUse(); $('rp-gift-use-wrap').hidden = true; }
          try { out.firstChild.focus(); } catch (err) {}
        }).then(function () { sending = false; btn.disabled = false; btn.textContent = was; });
        return;
      }
      var send = root.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
      send('rain-print-order', data, fs).then(function () {
        ga('rain_print_order', { result: 'ok', choice: x.choice, gift: gift ? 1 : plain ? 2 : 0 });
        out.innerHTML = gift
          ? '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> I\u2019ll email you within 1 business day with a payment link; nothing is charged until you pay it. Within 1 business day of paying, I email you a gift card to print.</p>' +
            '<p>Your ' + ST.year + ' print is made once the full year is in, and I send the ' + (x.choice === 'digital' ? 'finished file' : 'proof') + ' then, in January. I\u2019ll write to ' + esc(x.email) + '. Your design code is <code>' + esc(x.design_code) + '</code>.</p></div>'
          : x.choice === 'digital'
          ? '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> I\u2019ll email ' + esc(x.email) + ' within 1 business day with a payment link.</p>' +
            '<p>Nothing is charged until you pay that link. The finished file comes by email within 1 business day of paying. If you want anything changed, write to me and I\u2019ll fix it or redo it by hand and send it again, no charge.' +
            ' If the email doesn\u2019t come, check spam, or write to ' + ORDER_TO + (shortRef() ? ' and give your order reference, <b>' + esc(shortRef()) + '</b>.' : '.') + '</p></div>'
          : '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> I\u2019ll email ' + esc(x.email) + ' within 1 business day with a proof of this design and a payment link.</p>' +
            '<p>Nothing is charged until you pay that link, and nothing prints until you OK the proof. ' + ('It ships within ' + ((PRICES && PRICES.ship_business_days) || 3) + ' business days after you OK the proof.') +
            ' If the email doesn\u2019t come, check spam, or write to ' + ORDER_TO + (shortRef() ? ' and give your order reference, <b>' + esc(shortRef()) + '</b>.' : '.') + '</p></div>';
        SENT_CODE = encodeCode(ST);
        $('ro-form').reset(); $('ro-choice').value = x.choice; $('ro-design').value = x.design_url; syncAddress();
        try { out.firstChild.focus(); } catch (err) {}
      }).catch(function () {
        ga('rain_print_order', { result: 'fail', choice: x.choice, gift: gift ? 1 : plain ? 2 : 0 });
        var body = orderText(x);
        var href = 'mailto:' + ORDER_TO + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
        out.innerHTML = '<div class="rp-msg rp-bad"><p><b>That didn\u2019t go through, so nothing was sent.</b></p><p>Email it to ' + ORDER_TO + ' instead. The order is written out below.</p>' +
          '<p><a class="rp-btn2" id="ro-mail" href="' + esc(href) + '">Email the order</a></p><textarea readonly rows="7" aria-label="Your order, as text">' + esc(body) + '</textarea></div>';
        try { $('ro-mail').focus(); } catch (err) {}
      }).then(function () { sending = false; btn.disabled = false; btn.textContent = was; });
    }
  }

  // ---------- for businesses: a quote request for a set of prints ----------
  /* Its own form (#rb-form, kind rain-print-business, worker v5.12). It needs
     no drawn design: the business sends a list of towns and years and Sig
     quotes it. The cutoff line, the table and the per-print readout come only
     from data/rain-print.json (bizCutoffNote, bizRows, bizQuote above).
     Prices are delivered, shipping included (Sig, 2026-10-13). */
  var BIZ_PRODUCT = { print: 'print12x18', framed: 'framed12x18', digital: 'digital' };
  var BIZ_WORD = { print: ['print', 'prints'], framed: ['framed print', 'framed prints'], digital: ['digital file', 'digital files'],
    'not-sure': ['not sure yet', 'not sure yet'] };
  var BIZ_SHIP = { one: 'All to one address', each: 'One to each customer', 'not-sure': 'Not sure yet' };
  function radioVal(name) { var r = doc.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
  function syncBiz() {
    var j = PRICES;
    if (!j) return;
    var cut = bizCutoffNote(TODAY, j.business_cutoff);
    $('rp-biz-cutoff').textContent = cut; $('rp-biz-cutoff').hidden = !cut;
    var note = typeof j.business_note === 'string' ? cleanText(j.business_note, 300) : '';
    $('rp-biz-note').textContent = note; $('rp-biz-note').hidden = !note;
    var rows = bizRows(j), off = bizOff(j), max = bizQuoteMax(j, bizTiers(j.business_tiers));
    var firstOff = rows.filter(function (r) { return !r.retail; })[0];
    // the card's own line names the first discount price, so a dealer sees a number before opening it (2026-10-16)
    if (firstOff) $('rp-biz-sub').textContent = 'Elevators, co-ops, ag lenders, seed dealers. From ' + firstOff.from + ' prints: ' +
      money(firstOff.prices.framed12x18) + ' framed, ' + money(firstOff.prices.print12x18) + ' a print, delivered.';
    var offs = [];
    if (off.print12x18) offs.push(money(off.print12x18) + ' off each print');
    if (off.framed12x18) offs.push(money(off.framed12x18) + ' off each framed');
    $('rp-biz-ship').textContent = rows.length
      ? 'Every price is per print, delivered: shipping anywhere in the 50 states is included, one to each customer or all to one. ' +
        (offs.length && firstOff ? 'All to one address' + (firstOff.from > rows[0].from ? ', from ' + firstOff.from + ' prints' : '') + ': ' + offs.join(', ') + '. ' : '') + 'A digital file is ' + money(j.digital) + ' each, emailed. ' +
        (max < BIZ_MAX ? 'Over ' + max + ' prints, ask me for a quote.' : '')
      : 'I quote business orders by email. Shipping anywhere in the 50 states is included.';
    $('rp-biz-ship').hidden = false;
    $('rp-tiers-box').hidden = !rows.length;
    if (rows.length) {
      var hasOff = !!offs.length;
      var pair = function (o) { return money(o.print12x18) + ' / ' + money(o.framed12x18); };
      $('rp-tiers-head').innerHTML = '<tr><th scope="col" class="rp-l">Quantity</th><th scope="col">Print</th><th scope="col">Framed</th>' +
        (hasOff ? '<th scope="col" class="rp-sh">All to one address (print / framed)</th>' : '') + '</tr>';
      $('rp-tiers-body').innerHTML = rows.map(function (r) {
        // data-label: on a phone each row stacks into a card that names its cells (CSS in the page)
        return '<tr><th scope="row" class="rp-l">' + esc(bizRange(r)) + (r.retail ? ' <span class="rp-off">one invoice, no discount</span>' : '') + '</th>' +
          '<td class="rp-num" data-label="Print">' + money(r.prices.print12x18) + '</td><td class="rp-num" data-label="Framed">' + money(r.prices.framed12x18) + '</td>' +
          (hasOff ? '<td class="rp-num rp-sh" data-label="All to one address (print / framed)">' + pair(r.one) + '</td>' : '') + '</tr>';
      }).join('');
    }
    syncBizTier();
  }
  var BIZ_DEST = { one: ' to one address', each: ' to each customer' };
  function syncBizShip() {
    var each = radioVal('rb-ship') === 'each';
    $('rb-note-all-wrap').hidden = !each;
    $('rb-towns-help').hidden = !each;
  }
  function syncBizTier() {
    var out = $('rb-tier'), raw = String($('rb-qty').value || '').trim(), qty = /^\d{1,4}$/.test(raw) ? +raw : 0;
    var pick = radioVal('rb-product'), dest = radioVal('rb-ship'), id = BIZ_PRODUCT[pick];
    // the card prices' own style: $40, $1,234.50
    var c = function (x) { return money(x).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
    out.textContent = '';
    if (!qty || !PRICES) return;
    if (qty < BIZ_MIN) {
      out.innerHTML = 'For fewer than ' + BIZ_MIN + ', <a href="#rp-buy">order the regular way above</a>. Shipping is included in those prices.';
      return;
    }
    if (qty > BIZ_MAX) { out.textContent = 'Up to ' + BIZ_MAX + ' here. For more, put ' + BIZ_MAX + ' and say how many in the notes.'; return; }
    if (!id) return;
    var what = qty + ' ' + BIZ_WORD[pick][1];
    var one = bizQuote(PRICES, qty, id, 'one'), each = bizQuote(PRICES, qty, id, 'each');
    if (!one || !each) { out.textContent = 'For ' + qty + ', I quote it myself. Send the request and I\u2019ll write back.'; return; }
    if (id === 'digital') { out.textContent = what + ': ' + c(one.unit) + ' each, ' + c(one.total) + ' total, emailed.'; return; }
    var q = dest === 'one' ? one : dest === 'each' ? each : null;
    out.textContent = q
      ? what + BIZ_DEST[dest] + ': ' + c(q.unit) + ' each, delivered, ' + c(q.total) + ' total.'
      : one.unit === each.unit
        ? what + ': ' + c(each.unit) + ' each, delivered, ' + c(each.total) + ' total.'
        : what + ': ' + c(each.unit) + ' each, delivered, ' + c(each.total) + ' total. All to one address: ' + c(one.unit) + ' each, ' + c(one.total) + ' total.';
  }
  function bizSubject(x) { return 'Rain Print business quote: ' + x.business + ', ' + x.quantity + ' ' + BIZ_WORD[x.product][x.quantity === '1' ? 0 : 1]; }
  function bizText(x) {
    return bizSubject(x) + '\n\nBusiness: ' + x.business + '\nContact: ' + x.name + '\nEmail: ' + x.email + (x.phone ? '\nPhone: ' + x.phone : '') +
      '\nHow many: ' + x.quantity + '\nProduct: ' + BIZ_WORD[x.product][0] + '\nShip to: ' + BIZ_SHIP[x.ship] +
      (x.note_all ? '\nNote for every print: ' + x.note_all : '') + '\nTowns and years:\n' + x.towns + (x.notes ? '\nNotes: ' + x.notes : '') +
      (x.logo ? '\nLogo: ' + LOGO_LINK + x.logo : '') + '\n';
  }
  /* The quote form's logo (for the prints): the same reading
     and saving as the print's, no color switch. BIZ_LOGO = {id, url} once saved. */
  var BIZ_LOGO = null, BIZ_LOGO_ASK = 0;
  function bizLogoMsg(t, bad) { $('rb-logo-msg').textContent = t || ''; $('rb-logo-msg').classList.toggle('rp-bad', !!bad); }
  function syncBizLogo() {
    var th = $('rb-logo-thumb'), has = !!(BIZ_LOGO && BIZ_LOGO.url);
    th.hidden = !has; if (has) th.src = BIZ_LOGO.url; else th.removeAttribute('src');
    $('rb-logo-remove').hidden = !BIZ_LOGO;
    $('rb-logo-pick').textContent = BIZ_LOGO ? 'Choose another file' : 'Choose a file';
  }
  function pickBizLogo(file) {
    var A = root.AgRpLogo;
    if (!A || !file) return;
    var my = ++BIZ_LOGO_ASK;
    bizLogoMsg('Reading the logo\u2026');
    A.process(file).then(function (p) {
      if (my !== BIZ_LOGO_ASK) return;
      BIZ_LOGO = { id: '', url: p.url, saving: true };
      syncBizLogo(); bizLogoMsg('Saving the logo\u2026');
      return A.upload(p.blob).then(function (id) {
        if (my !== BIZ_LOGO_ASK) return;
        BIZ_LOGO = { id: id, url: p.url };
        syncBizLogo(); bizLogoMsg('Logo saved. It goes with your request.');
      });
    }).catch(function (e) {
      if (my !== BIZ_LOGO_ASK) return;
      BIZ_LOGO = null; syncBizLogo();
      bizLogoMsg(e && e.plain ? e.message : 'That logo didn\u2019t work. Try a PNG or JPG copy.', true);
    }).then(function () { try { $('rb-logo-file').value = ''; } catch (err) {} });
  }
  var bizSending = false;
  var BIZ_ASKED = '';   // the list the mismatch question was asked about: Send again sends it
  function submitBiz(e) {
    e.preventDefault();
    if (bizSending) return;
    var out = $('rb-out'), qraw = String($('rb-qty').value || '').trim();
    var x = {
      business: cleanText($('rb-business').value, 120), name: cleanText($('rb-name').value, 80), email: $('rb-email').value.trim(),
      phone: cleanText($('rb-phone').value, 30), quantity: qraw, product: radioVal('rb-product') || 'not-sure',
      towns: $('rb-towns').value.replace(/\r\n?/g, '\n').trim().slice(0, 8000), ship: radioVal('rb-ship') || 'not-sure',
      notes: $('rb-notes').value.replace(/\r\n?/g, '\n').trim().slice(0, 2000), page: '/rain-print#rp-biz'
    };
    var qn = /^\d{1,4}$/.test(qraw) ? +qraw : 0;
    var bad = !x.business ? ['rb-business', 'Add the business name.'] : !x.name ? ['rb-name', 'Add your name.']
      : !EMAIL_RE.test(x.email) ? ['rb-email', 'Add an email address I can reply to.']
      : qn >= 1 && qn < BIZ_MIN ? ['rb-qty', 'Business orders start at ' + BIZ_MIN + '. For fewer, order the regular way above.']
      : !(qn >= BIZ_MIN && qn <= BIZ_MAX) ? ['rb-qty', 'Put how many prints, from ' + BIZ_MIN + ' to ' + BIZ_MAX + '. For more than ' + BIZ_MAX + ', put ' + BIZ_MAX + ' and say how many in the notes.']
      : !x.towns ? ['rb-towns', 'Add the towns and years, or the one town for all of them.'] : null;
    if (!bad && BIZ_LOGO && BIZ_LOGO.saving) bad = ['rb-logo-file', 'The logo is still saving. Send again in a moment.'];
    if (bad) { out.innerHTML = '<p class="rp-msg rp-bad">' + esc(bad[1]) + '</p>'; try { $(bad[0]).focus(); } catch (err) {} return; }
    var ask = bizTownCheck(qn, x.towns), sig = qn + '|' + x.towns;
    if (ask && BIZ_ASKED !== sig) { BIZ_ASKED = sig; out.innerHTML = '<p class="rp-msg rp-bad">' + esc(ask) + '</p>'; try { $('rb-towns').focus(); } catch (err) {} return; }
    x.quantity = String(qn);
    if (BIZ_LOGO && BIZ_LOGO.id) x.logo = BIZ_LOGO.id;
    // the shared note (printed at the top of each box's letter) goes only to prints shipped one to each customer
    if (x.ship === 'each') { var na = $('rb-note-all').value.replace(/\r\n?/g, '\n').trim().slice(0, 300); if (na) x.note_all = na; }
    var hp = doc.querySelector('#rb-form input[name="_gotcha"]');
    var data = Object.assign({ _gotcha: hp ? hp.value : '' }, x);
    var subj = bizSubject(x);
    var fs = Object.assign({ _subject: subj, _replyto: x.email, form: 'rain-print-business' }, x);
    if (hp && hp.value) fs._gotcha = hp.value;
    var btn = $('rb-submit'), was = btn.textContent;
    bizSending = true; btn.disabled = true; btn.textContent = 'Sending…'; out.innerHTML = '';
    var send = root.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
    send('rain-print-business', data, fs).then(function () {
      ga('rain_print_business', { result: 'ok', product: x.product, qty: qn });
      out.innerHTML = '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> I\u2019ll write to ' + esc(x.email) + ' within 1 business day with a quote, then a proof sheet.</p>' +
        '<p>Nothing is printed or charged until you OK both.</p></div>';
      $('rb-form').reset(); syncBizShip(); syncBizTier();
      BIZ_LOGO_ASK++; BIZ_LOGO = null; syncBizLogo(); bizLogoMsg('');
      try { out.firstChild.focus(); } catch (err) {}
    }).catch(function () {
      ga('rain_print_business', { result: 'fail', product: x.product, qty: qn });
      var body = bizText(x);
      var href = 'mailto:' + ORDER_TO + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
      out.innerHTML = '<div class="rp-msg rp-bad"><p><b>That didn’t go through, so nothing was sent.</b></p><p>Email it to ' + ORDER_TO + ' instead. The request is written out below.</p>' +
        '<p><a class="rp-btn2" id="rb-mail" href="' + esc(href) + '">Email the request</a></p><textarea readonly rows="7" aria-label="Your quote request, as text">' + esc(body) + '</textarea></div>';
      try { $('rb-mail').focus(); } catch (err) {}
    }).then(function () { bizSending = false; btn.disabled = false; btn.textContent = was; });
  }

  // ---------- downloads ----------
  // the art's four files (same as the @font-face rules in rain-print.html): Fraunces and IBM Plex Sans, variable, Latin
  var FONT_FILES = [
    ['Fraunces', '300 600', 'normal', '/fonts/rp-fraunces-opsz.woff2'],
    ['Fraunces', '400', 'italic', '/fonts/rp-fraunces-opsz-400i.woff2'],
    ['IBM Plex Sans', '300 600', 'normal', '/fonts/rp-plex-sans-var.woff2'],
    ['IBM Plex Sans', '400', 'italic', '/fonts/rp-plex-sans-400i.woff2']
  ];
  var fontCssP = null;
  // card: the gift card also sets IBM Plex Mono
  function fontsReady(card) {
    var fs = doc.fonts;
    if (!fs || !fs.load) return Promise.resolve();
    var want = ["300 40px 'Fraunces'", "600 52px 'Fraunces'", "italic 400 21px 'Fraunces'", "300 50px 'IBM Plex Sans'", "400 16px 'IBM Plex Sans'",
      "500 16px 'IBM Plex Sans'", "italic 400 17px 'IBM Plex Sans'"];
    if (card) want = want.concat(["400 12px 'IBM Plex Mono'", "500 12px 'IBM Plex Mono'", "italic 400 12px 'IBM Plex Mono'"]);
    return Promise.all(want.map(function (f) { return fs.load(f); })).then(function () { return fs.ready; }, function () { return fs.ready; });
  }
  // An SVG drawn into a canvas cannot see the page's fonts, so the export carries them inline.
  function fontCss() {
    if (fontCssP) return fontCssP;
    fontCssP = Promise.all(FONT_FILES.map(function (f) {
      return fetch(f[3]).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (buf) {
        var bytes = new Uint8Array(buf), bin = '';
        for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return "@font-face{font-family:'" + f[0] + "';font-weight:" + f[1] + ';font-style:' + f[2] + ";src:url(data:font/woff2;base64," + btoa(bin) + ") format('woff2')}";
      }).catch(function () { return ''; });
    })).then(function (parts) { return parts.join(''); });
    return fontCssP;
  }
  function slug() {
    return ('rain-print-' + META.city + '-' + META.stateAbbr + '-' + META.year + '-' + ST.style).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = doc.createElement('a');
    a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  /* -> Promise<canvas>. kind 'preview' (watermarked, 2000 px wide), 'digital' (the
     $19 file: the art alone, 18 x 12 in at 300 dpi, no serial) or a print size key
     (Sig's print file: the 13 x 19 in sheet at 300 dpi, the art 16.5 x 11 in in the
     middle (SHEET), and the serial when the link has one; untrimmed, so no bleed and no crop marks). */
  /* own: the QR matrix of the print's own short link (an order file); without
     it the file carries the standard code. */
  function drawCanvas(kind, own) {
    var P = PRINT[kind === 'preview' || kind === 'digital' ? ST.size : kind];
    var o = { qrMatrix: own || null }, pxW, pxH, sheet = null;
    if (kind === 'preview') {
      pxW = 2000; pxH = Math.round(2000 * P.h / P.w); o.watermark = true;
    } else if (kind === 'digital') {
      pxW = P.w * DPI; pxH = P.h * DPI;
    } else {
      o.serial = SERIAL;
      if (!own) o.serial = '';   // a test print is no numbered print
      sheet = sheetBoxes();
      pxW = Math.round(SHEET.w * DPI); pxH = Math.round(SHEET.h * DPI);
    }
    // the art's own pixels: the whole canvas, or its box on the sheet
    var artPx = sheet ? [Math.round(sheet.art.w * DPI), Math.round(sheet.art.h * DPI)] : [pxW, pxH];
    var artAt = sheet ? [Math.round(sheet.art.x * DPI), Math.round(sheet.art.y * DPI)] : [0, 0];
    o.px = artPx;
    var saved = ST.size;
    if (PRINT[kind]) ST.size = kind;
    // The page's own fonts first (document.fonts), then the same files inlined
    // into the SVG, since an SVG drawn into a canvas cannot see page fonts.
    var svgP = fontsReady().then(fontCss).then(function (css) { o.fontCss = css; var s = buildSvg(o); ST.size = saved; return s; });
    return svgP.then(function (svg) {
      return new Promise(function (resolve, reject) {
        var img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        img.onload = function () {
          (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () {
            return new Promise(function (r) { setTimeout(r, 60); });
          }).then(function () { try {
            var c = doc.createElement('canvas');
            c.width = pxW; c.height = pxH;
            var cx = c.getContext('2d');
            // a sheet: the print's own white all round, the art in the middle
            if (sheet) { cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, pxW, pxH); }
            cx.drawImage(img, artAt[0], artAt[1], artPx[0], artPx[1]);
            URL.revokeObjectURL(url);
            resolve(c);
          } catch (e) { reject(e); } });
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
        img.src = url;
      });
    });
  }
  // a PNG comes back marked 300 dpi and sRGB (a canvas writes neither, so it opened at 72 dpi, 76 x 51 in)
  function toBlob(c, type, q) {
    return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('too large for this browser')); }, type, q); }).then(function (b) {
      if (type !== 'image/png' || !b.arrayBuffer) return b;
      return b.arrayBuffer().then(function (buf) { return new Blob([pngWithDpi(new Uint8Array(buf), DPI)], { type: 'image/png' }); });
    });
  }
  /* A one-page PDF around a JPEG, P inches wide and high (the 13 x 19 sheet, or the
     insert letter). bleedIn: a bleed in inches round P (TrimBox inset by it); 0 when left out. No library. */
  function pdfFromJpeg(jpeg, pxW, pxH, P, bleedIn) {
    var enc = new TextEncoder(), parts = [], offs = [], len = 0;
    var put = function (x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    var bi = bleedIn || 0;
    var wPt = (P.w + 2 * bi) * 72, hPt = (P.h + 2 * bi) * 72, bl = bi * 72;
    var content = 'q ' + wPt.toFixed(2) + ' 0 0 ' + hPt.toFixed(2) + ' 0 0 cm /Im0 Do Q';
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    var obj = function (n, body) { offs[n] = len; put(n + ' 0 obj\n'); body(); put('\nendobj\n'); };
    obj(1, function () { put('<< /Type /Catalog /Pages 2 0 R >>'); });
    obj(2, function () { put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); });
    obj(3, function () { put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wPt.toFixed(2) + ' ' + hPt.toFixed(2) + '] /BleedBox [0 0 ' + wPt.toFixed(2) + ' ' + hPt.toFixed(2) + '] /TrimBox [' + bl + ' ' + bl + ' ' + (wPt - bl).toFixed(2) + ' ' + (hPt - bl).toFixed(2) + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'); });
    obj(4, function () { put('<< /Type /XObject /Subtype /Image /Width ' + pxW + ' /Height ' + pxH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n'); put(jpeg); put('\nendstream'); });
    obj(5, function () { put('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'); });
    var xref = len;
    var x = 'xref\n0 6\n0000000000 65535 f \n';
    for (var i = 1; i <= 5; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }
  /* No maker file or letter while something the design asks for didn't load
     (loadFail): the file would go out without it. The watermarked preview is
     not an order and still saves. */
  function lostMsg() {
    var lost = loadFail();
    if (lost) makerMsg('No file saved: ' + lost + ' Press Draw again, then make the file.');
    return !!lost;
  }
  function exportFile(kind, fmt, btn) {
    if (!DATA || BLOCKED) return;
    if (kind !== 'preview' && lostMsg()) return;
    var was = btn.textContent, out = $('rp-dl-note');
    btn.disabled = true; btn.textContent = 'Making the file…';
    /* Sig's test print (2026-10-14): the 13 x 19 sheet PDF with the standard code to
       the Rain Print page, for his own test prints and samples. No short link,
       no worker call, no serial, so it works when the link service doesn't. */
    if (btn.getAttribute('data-qr') === 'standard') {
      var tname = slug() + '-' + kind + '-test-print-standard-code';
      logoGate().then(function (ok) { return extrasGate().then(function () { return ok; }); }).then(function (ok) { if (!ok) throw 'logo'; if (lostMsg()) throw 'lost'; return drawCanvas(kind, null); }).then(function (c) {
        return toBlob(c, 'image/jpeg', 1).then(function (j) { return j.arrayBuffer(); }).then(function (buf) {
          saveBlob(pdfFromJpeg(new Uint8Array(buf), c.width, c.height, SHEET), tname + '.pdf');
          out.textContent = 'Test print PDF saved, with the standard code (it opens the Rain Print page, not this design). Not for an order. ' + SHEET_WORDS + ', ' + c.width + ' x ' + c.height + ' px.';
          ga('rain_print_download', { kind: 'test', fmt: 'pdf' });
        });
      }).then(null, function (e) { if (e === 'lost') return; out.textContent = e === 'logo' ? 'The logo didn\u2019t load, so no file was saved. Try again in a minute.' : 'This browser couldn\u2019t make the file. Try it on a computer.'; })
        .then(function () { btn.disabled = false; btn.textContent = was; });
      return;
    }
    var name = slug() + (kind === 'preview' ? '-preview' : kind === 'digital' ? '-digital-300dpi' : '-' + kind + '-300dpi' + (SERIAL ? '-no-' + SERIAL.replace(/\D/g, '') : ''));
    var job, NO_QR = {};
    /* Every file someone pays for, or Sig prints, carries the print's own
       short-link QR: the long ?d= link makes modules too small to scan, and the
       standard code would send the buyer to the Rain Print page instead of their
       print. The short link is made now, one request (AgRpShort.mint), and the
       file waits for it; without it nothing is saved and the maker box says so
       with a Try again button. It never falls back to the standard code. The
       watermarked preview carries the standard code and asks for nothing. */
    var code = encodeCode(artDesign()), qrLink = '', own = null;
    var gate = kind === 'preview' ? Promise.resolve()
      : !code || !root.AgRpShort || !root.AgRpShort.mint || !root.AgQR ? Promise.reject(NO_QR)
      : root.AgRpShort.mint(code).then(function (link) {
        if (!link) throw NO_QR;
        try { own = root.AgQR.matrix(link); } catch (e) { own = null; }
        if (!own) throw NO_QR;
        qrLink = link;
      });
    var qrNote = function (msg) { return kind === 'preview' ? msg : msg + ' QR: ' + qrLink + '.'; };
    makerMsg('');
    // the logo is drawn from its data URL, so it is in the file at full size; a file waits for it (NO_LOGO when it never comes)
    var NO_LOGO = {}, LOST = {};
    var go = function (f) { return gate.then(function () { if (kind !== 'preview' && !own) throw NO_QR; return logoGate(); }).then(function (ok) { return extrasGate().then(function () { return ok; }); }).then(function (ok) { if (!ok) throw NO_LOGO; if (kind !== 'preview' && lostMsg()) throw LOST; return f(); }); };
    if (fmt === 'svg') {
      job = go(function () { return fontCss(); }).then(function (css) { return new Blob([buildSvg({ fontCss: css, px: ['18in', '12in'], qrMatrix: own })], { type: 'image/svg+xml' }); }).then(function (b) { saveBlob(b, slug() + '.svg'); return qrNote('SVG saved.'); });
    } else {
      job = go(function () { return drawCanvas(kind, own); }).then(function (c) {
        if (fmt === 'pdf') {
          return toBlob(c, 'image/jpeg', 1).then(function (j) { return j.arrayBuffer(); }).then(function (buf) {
            saveBlob(pdfFromJpeg(new Uint8Array(buf), c.width, c.height, SHEET), name + '.pdf');
            return qrNote('PDF saved: ' + SHEET_WORDS + ', ' + c.width + ' x ' + c.height + ' px.');
          });
        }
        return toBlob(c, 'image/png').then(function (b) {
          saveBlob(b, name + '.png');
          return qrNote(kind === 'preview' ? 'Preview saved (' + c.width + ' x ' + c.height + ' px, watermarked).'
            : kind === 'digital' ? 'Digital file saved: ' + c.width + ' x ' + c.height + ' px, 12 x 18 in at 300 dpi, no serial.'
            : 'Print file saved' + (SERIAL ? ' with ' + SERIAL : ', no serial (add &serial=N to the link)') + ': ' + SHEET_WORDS + ', ' + c.width + ' x ' + c.height + ' px at 300 dpi.');
        });
      });
    }
    job.then(function (msg) { out.textContent = msg; ga('rain_print_download', { kind: kind, fmt: fmt }); },
      function (e) {
        if (e === LOST) { out.textContent = ''; return; }
        if (e === NO_QR) {
          out.textContent = '';
          makerMsg('The link service didn\u2019t give this print its own short link (it may be busy), so no file was saved. An order file never uses the standard code. Try again in a minute; for a sample, use Test print PDF (standard code).', btn);
          return;
        }
        out.textContent = e === NO_LOGO ? 'The logo didn\u2019t load, so no file was saved. Try again in a minute.' : 'This browser couldn\u2019t make the file. Try it on a computer.';
      })
      .then(function () { btn.disabled = false; btn.textContent = was; });
  }
  /* THE INSERT LETTER (2026-10-17, Sig): one letter-size page that goes on top
     in every print and framed print box: what it is, the year's numbers as the
     print says them (AgRainArt.facts, from the same model the print is drawn
     from), how to read this style beside a small copy of the print drawn by the
     same engine, the giver's note or a business's message when the order has one (the
     boxes under the buttons: paste it from the order; there is no separate card), the serial and Sig's maker line, care,
     and the standard code to the Rain Print page. components/rp-insert.js lays
     it out; it loads on first use. No short link: the letter's code is the
     standard one. The digital file has no box, so no letter. */
  var INS_P = null;
  function insertReady() {
    if (root.AgRpInsert) return Promise.resolve(true);
    if (INS_P) return INS_P;
    INS_P = new Promise(function (res) {
      var sc = doc.createElement('script');
      sc.src = '/components/rp-insert.js?v=4';
      sc.onload = function () { res(!!root.AgRpInsert); };
      sc.onerror = function () { INS_P = null; res(false); };
      doc.head.appendChild(sc);
    });
    return INS_P;
  }
  function stationKind(m) {
    if (m && m.ca) return 'canada';
    var p = String((m && m.sid) || '').trim().split(/\s+/);
    return /^US1/.test(p[0]) ? 'volunteer' : p[1] === '2' ? 'coop' : 'noaa';
  }
  var LETTER = { w: 8.5, h: 11, label: '8.5 x 11 in' };
  /* -> {svg, facts, overflow} for the design on the page: the print's own input,
     drawn once small (the miniature, with the serial it carries) so the facts
     leave off exactly the days the print leaves off. */
  function insertSvg(gift, fontCssText, px, from) {
    var I = artInput({ serial: SERIAL, idPrefix: 'rpins' });
    var mini = root.AgRainArt.render(I);
    var F = root.AgRainArt.facts(I, { unplaced: root.AgRainArt.lastUnplaced() });
    var svg = root.AgRpInsert.render({
      facts: F, mini: mini, serial: SERIAL, gift: printable(gift || ''), giftFrom: printable(cleanText(from, 40)), qr: standardMatrix(), fontCss: fontCssText, px: px,
      station: { words: gaugeWords(META), away: META.approx ? '' : milesText(miles(META.km)).replace(/ mi$/, ' miles'), kind: stationKind(META) },
      source: META && META.ca ? 'Environment and Climate Change Canada\u2019s daily records' : 'NOAA\u2019s daily records',
      offer: (PRICES && PRICES.letter_offer) || null, today: TODAY   // data/rain-print.json letter_offer: empty code, no line
    });
    return { svg: svg, facts: F, overflow: root.AgRpInsert.lastOverflow() };
  }
  function insertFile(btn) {
    var out = $('rp-dl-note');
    if (!DATA || BLOCKED) return;
    if (lostMsg()) return;
    if (PREVIEW) { out.textContent = 'The letter is made from the full year, like the print. Make it in January once the year is in.'; return; }
    if (META && META.ca && FR()) { out.textContent = 'The letter is in English only for now.'; return; }
    var was = btn.textContent, note = $('rp-ins-gift') ? $('rp-ins-gift').value : '', from = $('rp-ins-from') ? $('rp-ins-from').value : '';
    btn.disabled = true; btn.textContent = 'Making the letter\u2026';
    var pxW = LETTER.w * DPI, pxH = LETTER.h * DPI, info = null;
    insertReady().then(function (ok) { if (!ok) throw 'load'; return fontsReady(); }).then(fontCss).then(function (css) {
      info = insertSvg(note, css, [pxW, pxH], from);
      return new Promise(function (resolve, reject) {
        var img = new Image(), url = URL.createObjectURL(new Blob([info.svg], { type: 'image/svg+xml' }));
        img.onload = function () {
          (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () { return new Promise(function (r) { setTimeout(r, 60); }); }).then(function () {
            try { var c = doc.createElement('canvas'); c.width = pxW; c.height = pxH; c.getContext('2d').drawImage(img, 0, 0, pxW, pxH); URL.revokeObjectURL(url); resolve(c); } catch (e) { reject(e); }
          });
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
        img.src = url;
      });
    }).then(function (c) {
      return toBlob(c, 'image/jpeg', 1).then(function (j) { return j.arrayBuffer(); }).then(function (buf) {
        saveBlob(pdfFromJpeg(new Uint8Array(buf), c.width, c.height, LETTER, 0), slug() + '-insert-letter' + (SERIAL ? '-no-' + SERIAL.replace(/\D/g, '') : '') + '.pdf');
        out.textContent = 'Insert letter saved: ' + LETTER.label + ', ' + c.width + ' x ' + c.height + ' px at 300 dpi' + (SERIAL ? ', ' + SERIAL : ', no serial (a blank to fill in by hand; add &serial=N to the link)') +
          (note.trim() ? ', with the gift note' : ', no gift note') + '.' + (info.overflow ? ' The page ran long by ' + info.overflow + ' units: shorten the gift note.' : '');
        ga('rain_print_download', { kind: 'insert', fmt: 'pdf' });
      });
    }).then(null, function (e) { out.textContent = e === 'load' ? 'The letter\u2019s layout file didn\u2019t load. Try again in a minute.' : 'This browser couldn\u2019t make the letter. Try it on a computer.'; })
      .then(function () { btn.disabled = false; btn.textContent = was; });
  }

  /* A plain message in the maker box; with retry (the button that failed) it
     ends in a Try again button that runs the same export again. */
  function makerMsg(text, retry) {
    var m = $('rp-maker-msg');
    if (!m) return;
    m.textContent = text;
    m.hidden = !text;
    if (retry) {
      var b = doc.createElement('button');
      b.type = 'button'; b.className = 'btn btn-secondary'; b.id = 'rp-maker-retry'; b.textContent = 'Try again';
      b.addEventListener('click', function () { makerMsg(''); exportFile(retry.getAttribute('data-size'), retry.getAttribute('data-fmt'), retry); });
      m.appendChild(doc.createTextNode(' '));
      m.appendChild(b);
    }
  }

  // ---------- wire up ----------
  buildYears();
  buildDayLists();
  /* Back from Stripe: rain-print?paid=<product>&s=<session> (PAID below). The
     design saved at the press draws again under the thank-you. */
  var PAID = paidFromUrl(root.location.search), PAID_SAVED = PAID ? paidSaved() : null;
  // the print is named and drawn again only for the design this payment is for (the same product); otherwise the thank-you stays general
  if (PAID_SAVED && PAID_SAVED.choice !== PAID.choice) PAID_SAVED = null;
  if (PAID && PAID_SAVED && !ST.place) { var ps = decodeCode(PAID_SAVED.code); if (ps) ST = ps; }
  /* A new visitor: the boxes start empty (the example is in them as gray
     hints) and the comparison, the normals and the remarkable days are on
     (2026-10-14, Sig; remarkable days on from 2026-10-15, Sig: "default the rain
     print to display the remarkable days on page load"); the print at the top
     wears the example words until the reader does something. A design from a
     link comes in as it was made. */
  if (!ST.place) { ST.cmp = 'normal'; ST.normals = true; ST.records = true; ST.frost = true; ST.heat = true; SHOW_EX = !PAID; }
  writeInputs(ST);
  doc.querySelectorAll('.rp-cy').forEach(function (el) { el.textContent = String(CURRENT_YEAR); });
  // the Christmas lines read right from October 1 through December 25 only
  XMAS_OFF = parseInt(TODAY.slice(5, 7), 10) < 10 || TODAY.slice(5) > '12-25';
  if (MAKER) $('rp-maker').hidden = false;
  /* The product picked comes back after Back or a reload (2026-10-15: it
     always started on Framed, so Print showed $89 on the way back): the
     address (?pick=), else the pick saved at the press for this same design,
     else the radio the browser kept, else Framed. */
  function startPick() {
    var u = new URLSearchParams(root.location.search).get('pick');
    if (PRODUCTS.indexOf(u) >= 0) { PICK_CHOSEN = true; return u; }
    var sv = savedCheckout();
    if (sv && !PAID && sv.code === encodeCode(ST) && PRODUCTS.indexOf(sv.choice) >= 0) { PICK_CHOSEN = true; return sv.choice; }
    var r = radios('rp-product').filter(function (x) { return x.checked; })[0];
    if (r && r !== radios('rp-product')[0]) PICK_CHOSEN = true;   // a pick the browser kept
    return r && PRODUCTS.indexOf(r.value) >= 0 ? r.value : 'framed12x18';
  }
  setPick(startPick());
  root.addEventListener('pagehide', function () { if (URL_T) updateUrlNow(); });
  root.addEventListener('pageshow', function () {
    var r = radios('rp-product').filter(function (x) { return x.checked; })[0];
    if (r && r.value !== PICK) setPick(r.value); else syncPick();
  });
  if (PAID) showPaid(PAID, PAID_SAVED);
  form.addEventListener('submit', run);
  $('rp-station').addEventListener('change', function () {
    ST.station = $('rp-station').value;
    if (SAMPLE) run(null, Object.assign({}, ST)); else run();
  });
  $('rp-sample-use').addEventListener('click', useSample);
  // the order form opened because checkout didn't: try checkout again, from the review sheet
  $('ro-retry-go').addEventListener('click', function () { $('rp-order').hidden = true; $('ro-retry').hidden = true; openProof(); pay(); });
  /* Step 1 draws on its own (2026-10-14): a new year draws the moment it is
     picked, and a town typed draws when the box is left (or on Enter, or Draw
     my year). The line by the print says what is on its way. */
  var noop = function () {};
  $('rp-year').addEventListener('change', function () {
    syncDayLists(); syncDates(); syncYearNote();
    if (GIFT && GIFT.lock) return;
    if ($('rp-place').value.trim()) run({ type: 'submit', preventDefault: noop, auto: true }); else syncPending();
  });
  $('rp-place').addEventListener('input', syncPending);
  $('rp-place').addEventListener('change', function () {
    // a tap on Draw my year right after typing is a submit of its own: this waits for it, then draws only if nothing did
    setTimeout(function () { var n = readInputs(); if (!DRAWING && n.place && (SAMPLE || n.place !== ST.place)) run({ type: 'submit', preventDefault: noop, auto: true }); }, 300);
  });
  ['rp-name', 'rp-ded'].concat(dayNums().map(function (i) { return 'rp-m' + i + 'l'; })).forEach(function (id) { catchPaste($(id)); });
  /* THE FUNNEL (2026-10-16): one rain_print_words per kind of word a reader
     touches (name, line, day), once per visit. It says which box, never what
     was typed. */
  var WORDS_SENT = {};
  function wordsEvent(kind) { if (WORDS_SENT[kind]) return; WORDS_SENT[kind] = true; ga('rain_print_words', { field: kind }); }
  ['rp-name', 'rp-ded'].concat(dayNums().map(function (i) { return 'rp-m' + i + 'l'; })).forEach(function (id) {
    $(id).addEventListener('change', function () { if ($(id).value.trim()) wordsEvent(id === 'rp-name' ? 'name' : id === 'rp-ded' ? 'line' : 'day'); });
  });
  ['rp-name', 'rp-ded'].concat(dayNums().map(function (i) { return 'rp-m' + i + 'l'; })).forEach(function (id) { $(id).addEventListener('input', function () { endExample(); cleanField(id); if (id === 'rp-name' && $(id).value) $('rp-noname').hidden = true; restyle(true); syncDates(); }); });
  dayNums().forEach(function (i) {
    // the chip's "now pick its month and day" has been followed (or the reader moved on): it goes
    $('rp-m' + i + 'mo').addEventListener('change', function () { endExample(); syncDayList(i); syncDates(); restyle(); stripSay(i); dateSay(''); });
    $('rp-m' + i + 'dy').addEventListener('change', function () { endExample(); syncDates(); restyle(); stripSay(i); dateSay(''); if ($('rp-m' + i + 'dy').value) wordsEvent('day'); });
    $('rp-m' + i + 'l').addEventListener('input', function () { dateSay(''); });
    $('rp-m' + i + 'l').addEventListener('change', function () { stripSay(i); });
    $('rp-m' + i + 'rm').addEventListener('click', function () { removeDay(i); });
    // a half-picked day says so once the reader leaves its row
    $('rp-m' + i + 'row').addEventListener('focusout', function (e) {
      var row = $('rp-m' + i + 'row');
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      if (rowUsed(i)) { TOUCHED[i] = true; syncDates(); }
    });
  });
  $('rp-add-day').addEventListener('click', addDay);
  /* label ideas as buttons: a tap fills the first empty label, opening its row
     if it is closed (its month next), and says so (panel 5, 2026-10-15: a tap
     did nothing visible on a phone, and a 4th did nothing at all) */
  LABEL_PRESETS.forEach(function (w) {
    var b = doc.createElement('button'); b.type = 'button'; b.textContent = w; b.setAttribute('data-en', w);
    b.addEventListener('click', function () {
      var w = b.textContent;   // the word as shown (French on a French design: components/rp-canada.js)
      endExample(); wordsEvent('day');
      for (var i = 1; i <= LIMITS.markers; i++) if (!$('rp-m' + i + 'l').value) {
        $('rp-m' + i + 'row').hidden = false; $('rp-m' + i + 'l').value = w; TOUCHED[i] = false;
        cleanField('rp-m' + i + 'l'); syncRows(); restyle(); syncDates();
        var mo = $('rp-m' + i + 'mo').value, dy = $('rp-m' + i + 'dy').value;
        dateSay(w + ' is day ' + i + (mo && dy ? ', ' + shortDate(rowDate(i)) + '.' : mo ? '. Now pick its day.' : '. Now pick its month and day.'));
        stripSay(i);
        try { $('rp-m' + i + (mo ? 'dy' : 'mo')).focus(); } catch (e) {}
        return;
      }
      dateSay(MAX_WORDS);
    });
    $('rp-presets').appendChild(b);
  });
  syncRows();
  syncCounts();
  radios('rp-style').forEach(function (r) { r.addEventListener('change', function () { restyle(); }); });
  // Canada: mm or inches, English or French (the choice rides in the design)
  radios('rp-units').forEach(function (r) { r.addEventListener('change', function () { ST.units = r.value; restyle(); syncCa(); ga('rain_print_units', { units: r.value }); }); });
  radios('rp-lang').forEach(function (r) { r.addEventListener('change', function () { ST.lang = r.value; restyle(); syncCa(); if (DATA && !BLOCKED) { render(); drawnStatus(); } ga('rain_print_lang', { lang: r.value }); }); });
  // the normals are NOAA's 30-year normal: showing them makes that the comparison, and another comparison turns them off
  $('rp-normals').addEventListener('change', function () { if ($('rp-normals').checked) $('rp-cmp').value = 'normal'; restyle(); });
  $('rp-cmp').addEventListener('change', function () { if ($('rp-cmp').value !== 'normal') $('rp-normals').checked = false; restyle(); });
  $('rp-records').addEventListener('change', function () { restyle(); });
  /* The 2026-10-17 options. A crop picked fills its days from marked days whose words say so (Planted,
     Harvest); the temperature switches read the temperature station the first time one is on; the history
     threads change the station (the nearest with 30 full years), so they draw the year again. */
  $('rp-crop').addEventListener('change', function () {
    if ($('rp-crop').value) {
      if (!$('rp-crop-plant').value) ST.cropPlant = guessCropDay(/plant|seed/i);
      if (!$('rp-crop-harvest').value) ST.cropHarvest = guessCropDay(/harvest|combin/i);
      ST.crop = $('rp-crop').value; syncCropDays();
    }
    syncCropDays(); restyle(); extrasLoad(reqToken);
  });
  ['rp-crop-plant', 'rp-crop-harvest', 'rp-plants', 'rp-ghost', 'rp-frost', 'rp-heat', 'rp-ribbon'].forEach(function (id) {
    $(id).addEventListener('change', function () { restyle(); extrasLoad(reqToken); });
  });
  $('rp-hist').addEventListener('change', function () {
    HIST_WHY = '';
    ST.hist = $('rp-hist').checked;
    if (!DATA || SAMPLE) { restyle(); return; }
    ST.station = ''; run();
  });
  // the logo: a file in, the color switch, remove
  $('rp-logo-file').addEventListener('change', function () { var f = $('rp-logo-file').files; if (f && f[0]) logoReady().then(function (ok) { if (ok) pickLogo(f[0]); else logoMsg('The logo tool didn\u2019t load. Check the connection and choose the file again.'); }); });
  $('rb-logo-file').addEventListener('change', function () { var f = $('rb-logo-file').files; if (f && f[0]) logoReady().then(function (ok) { if (ok) pickBizLogo(f[0]); else bizLogoMsg('The logo tool didn\u2019t load. Check the connection and choose the file again.'); }); });
  // the file picker is about to open: start loading the logo tool now
  ['rp-logo-pick', 'rb-logo-pick'].forEach(function (id) { var b = $(id); if (b) ['pointerdown', 'focus'].forEach(function (ev) { b.addEventListener(ev, function () { logoReady(); }, { once: true }); }); });
  radios('rp-logo-ink').forEach(function (r) { r.addEventListener('change', function () { restyle(); }); });
  $('rp-logo-remove').addEventListener('click', removeLogo);
  $('rb-logo-remove').addEventListener('click', function () { BIZ_LOGO_ASK++; BIZ_LOGO = null; syncBizLogo(); bizLogoMsg(''); try { $('rb-logo-pick').focus(); } catch (e) {} });
  // step 3: the picker (and its copy in the review sheet), the button, the no-name question, the phone bar
  radios('rp-product').concat(radios('rp-pproduct')).forEach(function (r) { r.addEventListener('change', function () { if (r.checked) { endExample(); PICK_CHOSEN = true; setPick(r.value); if (DATA) updateUrl(); ga('rain_print_pick', { choice: r.value, where: r.name === 'rp-pproduct' ? 'review' : 'step3' }); } }); });
  $('rp-pay').addEventListener('click', checkIt);
  $('rp-bar-go').addEventListener('click', checkIt);
  $('rp-noname-add').addEventListener('click', function () {
    $('rp-noname').hidden = true;
    try { $('rp-name').scrollIntoView({ behavior: smooth(), block: 'center' }); } catch (e) {}
    try { $('rp-name').focus({ preventScroll: true }); } catch (e) {}
  });
  $('rp-noname-go').addEventListener('click', function () { NONAME_OK = true; $('rp-noname').hidden = true; checkIt(); });
  $('ro-choice').addEventListener('change', function () { syncAddress(); syncSummary(); });
  $('rp-zoom').addEventListener('click', openProof);
  $('rp-strip-zoom').addEventListener('click', openProof);
  // tap the picture to see it up close (the Zoom in button is the keyboard way in)
  art.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a,button,input,select')) return; openProof(); });
  $('rp-proof-close').addEventListener('click', function () { closeProof(false); });
  $('rp-proof-order').addEventListener('click', function () { pay(); });
  $('rp-proof-change').addEventListener('click', function () {
    closeProof(true);
    try { $('rp-design').scrollIntoView({ behavior: smooth(), block: 'start' }); } catch (e) {}
    try { $('rp-name').focus({ preventScroll: true }); } catch (e) {}
  });
  var proofDlg = $('rp-proof');
  // a click on the dimmed page around the dialog closes it
  proofDlg.addEventListener('click', function (e) { if (e.target === proofDlg) closeProof(false); });
  // Esc at actual size goes back to Fit; at Fit it closes
  proofDlg.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && PROOF_ZOOM === 'full') { e.preventDefault(); e.stopPropagation(); proofZoom('fit'); try { $('rp-proof-zoom').focus(); } catch (err) {} return; }
    // Tab wraps inside the dialog, so focus never leaves for the browser's own bar
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(proofDlg.querySelectorAll('button, input, [tabindex="0"]'), function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], at = doc.activeElement;
    if (e.shiftKey && (at === first || !proofDlg.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !proofDlg.contains(at))) { e.preventDefault(); first.focus(); }
  });
  proofDlg.addEventListener('cancel', function (e) { if (PROOF_ZOOM === 'full') { e.preventDefault(); proofZoom('fit'); } });
  proofDlg.addEventListener('close', function () {
    var f = PROOF_FROM; PROOF_FROM = null;
    if (!PROOF_HANDOFF && f && doc.contains(f) && f.offsetParent !== null) { try { f.focus({ preventScroll: true }); } catch (e) {} }
    PROOF_HANDOFF = false;
    syncBar(); syncStrip();
  });
  // the slim copy that pins under the menu on a phone opens the up-close view too
  $('rp-mini').addEventListener('click', openProof);
  $('rp-proof-ok').addEventListener('change', function () { PROOF_OK = $('rp-proof-ok').checked ? encodeCode(ST) : ''; if (PROOF_OK) proofSay(''); syncSummary(); });
  $('rp-proof-zoom').addEventListener('click', function () { proofZoom(PROOF_ZOOM === 'full' ? 'fit' : 'full'); });
  // click the print to see that spot at actual size; at actual size, drag to move around
  (function () {
    var st = $('rp-proof-stage'), down = null, moved = false;
    st.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0 || PROOF_ZOOM !== 'full') return;
      down = { x: e.clientX, y: e.clientY, l: st.scrollLeft, t: st.scrollTop }; moved = false;
      e.preventDefault();
    });
    root.addEventListener('pointermove', function (e) {
      if (!down) return;
      if (!moved && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) { moved = true; st.classList.add('rp-drag'); }
      if (moved) { st.scrollLeft = down.l - (e.clientX - down.x); st.scrollTop = down.t - (e.clientY - down.y); }
    });
    root.addEventListener('pointerup', function () { down = null; st.classList.remove('rp-drag'); });
    st.addEventListener('click', function (e) {
      if (PROOF_ZOOM !== 'fit' || !(e.target.closest && e.target.closest('#rp-proof-frame'))) return;
      proofZoom('full', { x: e.clientX, y: e.clientY });
    });
  })();
  $('ro-deliver').addEventListener('change', syncAddress);
  $('ro-isgift').addEventListener('change', syncAddress);
  // the review sheet's gift fields write through to the order form's
  $('rp-pg-on').addEventListener('change', function () {
    $('ro-isgift').checked = $('rp-pg-on').checked;
    if ($('rp-pg-on').checked && !$('rp-pg-deliver').value) $('rp-pg-deliver').value = 'recipient';
    syncAddress(); pgSync(); proofSay('');
    if ($('rp-pg-on').checked) try { $('rp-pg-to').focus({ preventScroll: false }); } catch (e) {}
  });
  Object.keys(PG_MIRROR).forEach(function (k) {
    $(k).addEventListener(k === 'rp-pg-deliver' ? 'change' : 'input', function () {
      $(PG_MIRROR[k]).value = $(k).value;
      if (PG_JAN[k] && januaryGift()) $(PG_JAN[k]).value = $(k).value;
      if (k === 'rp-pg-deliver') syncAddress();
      pgSync();
    });
  });
  $('ro-form').addEventListener('submit', submitOrder);
  $('rb-form').addEventListener('submit', submitBiz);
  $('rb-qty').addEventListener('input', syncBizTier);
  radios('rb-product').concat(radios('rb-ship')).forEach(function (r) { r.addEventListener('change', syncBizTier); });
  radios('rb-ship').forEach(function (r) { r.addEventListener('change', syncBizShip); });
  $('rp-dl').addEventListener('click', function () { exportFile('preview', 'png', $('rp-dl')); });
  doc.querySelectorAll('#rp-maker button').forEach(function (b) {
    b.addEventListener('click', function () { if (b.getAttribute('data-size') === 'insert') insertFile(b); else exportFile(b.getAttribute('data-size'), b.getAttribute('data-fmt'), b); });
  });
  $('rp-copy').addEventListener('click', function () {
    // a logo still saving has no id: the link would leave it off (panel 3 F1)
    if (LOGO && LOGO.state === 'saving') { $('rp-dl-note').textContent = 'The logo is still saving. Copy the link in a moment.'; return; }
    var u = shortUrl(artDesign()), b = $('rp-copy');
    var ok = function () { b.textContent = 'Link copied'; $('rp-dl-note').textContent = 'Link copied.'; setTimeout(function () { b.textContent = 'Copy link'; }, 2000); };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(u).then(ok, function () { root.prompt('Copy this link', u); });
    else root.prompt('Copy this link', u);
  });
  $('rp-gift-use').addEventListener('click', function () { useGift(); });
  /* "Make another" (2026-10-17, farm-buyers panel: Dad's last year, then my
     first): the town and the words stay; the Year box comes up to change. */
  $('rp-start').addEventListener('click', function (ev) {
    ev.preventDefault();
    var p = $('rp-place');
    try { p.scrollIntoView({ behavior: smooth(), block: 'center' }); } catch (e) {}
    try { p.focus({ preventScroll: true }); } catch (e) { p.focus(); }
    ga('rain_print_start', {});
  });
  // the line over a shared print: the town box, its text selected so typing replaces the shared town
  $('rp-shared-own').addEventListener('click', function (ev) {
    ev.preventDefault();
    var p = $('rp-place');
    try { p.scrollIntoView({ behavior: smooth(), block: 'center' }); } catch (e) {}
    try { p.focus({ preventScroll: true }); } catch (e) { p.focus(); }
    try { p.select(); } catch (e) {}
    ga('rain_print_shared_own', {});
  });
  // last year, by Christmas: the same town, last year, drawn now (the station is picked again for that year)
  $('rp-xmas-last').addEventListener('click', function () {
    if (GIFT && GIFT.lock) return;
    $('rp-year').value = String(CURRENT_YEAR - 1);
    ga('rain_print_last_year', { from: 'top' });
    run({ type: 'submit', preventDefault: function () {} });
  });
  $('rp-another').addEventListener('click', function () {
    var y = $('rp-year');
    try { y.scrollIntoView({ behavior: smooth(), block: 'center' }); } catch (e) {}
    try { y.focus({ preventScroll: true }); } catch (e) {}
    try { if (typeof y.showPicker === 'function') y.showPicker(); } catch (e) {}
    ga('rain_print_another', {});
  });
  $('rp-retry').addEventListener('click', function () {
    // the button is about to vanish: keep the keyboard on the town box
    try { $('rp-place').focus({ preventScroll: true }); } catch (e) {}
    $('rp-retry-row').hidden = true;
    run();
  });
  doc.addEventListener('click', function (ev) {
    var t = ev.target;
    // the station box is under More options: open it first
    if (t && t.id === 'rp-chg') { ev.preventDefault(); $('rp-more').open = true; var sl = $('rp-station'); try { sl.scrollIntoView({ behavior: smooth(), block: 'center' }); sl.focus({ preventScroll: true }); } catch (e) {} }
  });
  /* Two example years by the town box (Sig, 2026-10-14; the made-up family
     year went with the example words): a drought and a flood. Each is a plain
     link (it works with no script); a tap draws it in place, in the reader's
     chosen style, keeping any words they have typed. */
  doc.querySelectorAll('.rp-story').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      if (GIFT && GIFT.lock) return;
      ev.preventDefault();
      var s0 = fromParams(a.getAttribute('href').split('?')[1] || '');
      if (!s0.place || !s0.year) return;
      var s = readInputs(s0.year);
      s.place = s0.place; s.year = s0.year; s.station = ''; s.cmp = s0.cmp;
      NEAR = '';
      writeInputs(s);
      ga('rain_print_story', { year: s.year });
      run({ type: 'submit', preventDefault: function () {} });
    });
  });
  // the phone's pinned copy and bottom bar follow the scroll, the screen size and the keyboard
  (function () {
    var tick = false;
    var later = function () { if (tick) return; tick = true; (root.requestAnimationFrame || setTimeout)(function () { tick = false; syncStrip(); syncBar(); }); };
    root.addEventListener('scroll', later, { passive: true });
    root.addEventListener('resize', later);
    if (root.IntersectionObserver) new root.IntersectionObserver(function (es) {
      PAY_SEEN = es[es.length - 1].isIntersecting; syncBar();
      // the funnel: the pay button came on screen, once a visit (sample says whether it was still the sample)
      if (PAY_SEEN && !STEP3_SENT) { STEP3_SENT = true; ga('rain_print_step3', { choice: PICK, sample: SAMPLE ? 1 : 0 }); }
    }).observe($('rp-pay-wrap'));
    var typing = function (el) { return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(radio|checkbox|button|submit|file)$/i.test(el.type || '') && !$('rp-proof').contains(el); };
    /* The bar goes the moment a box has the keyboard and comes back a moment
       after it leaves, so it never pops up under a finger that is already on
       its way to a button (2026-10-14: a tap on "Wedding" landed on the bar). */
    var back = 0;
    doc.addEventListener('focusin', function (e) {
      clearTimeout(back);
      if (typing(e.target)) { TYPING = true; syncBar(); setTimeout(function () { keepFocusClear(); }, 60); }
      else back = setTimeout(function () { TYPING = false; syncBar(); }, 450);
    });
    doc.addEventListener('focusout', function () { clearTimeout(back); back = setTimeout(function () { TYPING = typing(doc.activeElement); syncBar(); }, 450); });
  })();
  // Back from Stripe with the page kept as it was: no "Opening checkout" left on the screen
  root.addEventListener('pageshow', function (e) { if (e.persisted) { proofSay(''); syncBar(); } });
  // the business card opens itself for a link to it
  var STEP3_SENT = false;
  $('rp-biz-d').addEventListener('toggle', function () { if ($('rp-biz-d').open && !BIZ_SENT) { BIZ_SENT = true; ga('rain_print_business_open', {}); } });
  var BIZ_SENT = false;
  function bizHash() { if (root.location.hash === '#rp-biz' || root.location.hash === '#rb-form') $('rp-biz-d').open = true; }
  root.addEventListener('hashchange', bizHash);
  bizHash();
  // Came from a county rain page: a way back to it, under the status line
  try {
    var REF = doc.referrer ? new URL(doc.referrer) : null;
    if (REF && REF.origin === root.location.origin && /^\/rain\/./.test(REF.pathname)) {
      $('rp-back').innerHTML = 'Back to the <a href="' + esc(REF.pathname) + '">county rain page</a>';
      $('rp-back').hidden = false;
    }
  } catch (e) {}
  /* ?d=RPS-<id>: look the id up the way /r does (rp-short.js), then draw that
     design. A lookup that fails says so over the reader's own area. */
  function openRef(ref) {
    var name = (ref.gift ? GIFT_PREFIX : '') + 'RPS-' + ref.id;
    setStatus('Opening design ' + name + '\u2026');
    var look = root.AgRpShort && root.AgRpShort.resolve ? root.AgRpShort.resolve(ref.id) : Promise.resolve({ code: null });
    look.then(function (r) {
      var s = r && r.code ? decodeCode(r.code) : null;
      if (!s) {
        sharedOff();
        $('rp-link-note').textContent = 'Design ' + name + (r && r.missing
          ? ' isn\u2019t one the site knows. Check the reference, or type the town and press Draw it.'
          : ' didn\u2019t open: the link service didn\u2019t answer. Try again in a minute, or open agsist.com/r?' + ref.id + '.');
        $('rp-link-note').classList.add('rp-bad');
        $('rp-link-note').hidden = false;
        setStatus('');
        // Sig's print files page draws nothing in its place; a reader gets their area,
        // and the reference stays in the address bar until they draw their own
        if (!MAKER) { KEEP_URL = true; startNear(); }
        return;
      }
      if (ref.gift) s.gift = true;
      ST = s;
      // a design from a link comes in as it was made: no example words on it (they went on an RPS- design with no name of its own)
      SHOW_EX = false;
      sharedSet(s);
      writeInputs(ST);
      markLinkCuts(cutLabels('?d=' + r.code));
      run();
    });
  }
  // A share link that can't be drawn says why, over the sample (2026-10-13: it fell back quietly).
  var LINK_WHY = linkProblem(root.location.search);
  markLinkCuts(cutLabels(root.location.search));
  if (LINK_WHY) { $('rp-link-note').textContent = LINK_WHY; $('rp-link-note').hidden = false; }
  if (LINK_WHY || PAID || MAKER) sharedOff(); else sharedSet(ST);
  showBuy(false);
  /* The art measures its labels with these fonts: draw again once they are in.
     They are asked for when a draw starts, when the reader reaches the form, or
     after the page has loaded, not at the start (2026-10-17, speed panel: about
     170 KB of print fonts raced the page's own scripts on a slow phone). */
  var FONTS_ASKED = false;
  function fontsSoon() {
    if (FONTS_ASKED) return;
    FONTS_ASKED = true;
    fontsReady().then(function () { if (DATA && !BLOCKED) render(); });
  }
  if (doc.readyState === 'complete') setTimeout(fontsSoon, 0);
  else root.addEventListener('load', function () { setTimeout(fontsSoon, 0); });
  ['focusin', 'pointerdown'].forEach(function (ev) { form.addEventListener(ev, fontsSoon, { once: true }); });
  PRICES_P = loadPrices();
  // a town with no year, or a year that can't be drawn, draws the last full year (linkProblem says so)
  var LINK_REF = ST.place ? null : shortRefOf(new URLSearchParams(root.location.search).get('d'));
  if (LINK_REF) openRef(LINK_REF);
  else if (ST.place && ST.year) run();
  else if (ST.place) { ST.year = lastFullYear(); writeInputs(ST); run(); }
  else startNear();

  /* THE GIFT CARD (2026-10-13). A card is issued by Sig after payment (worker
     v5.16) and printed from /rp-gift. Its link, /rain-print?gift=RP-XXXX-XXXX-XXXX,
     is redeemed here through components/rp-gift.js (loaded with defer, so this
     runs once the page is parsed): a banner says whose gift it is, a locked
     card draws its design and holds those inputs still, the three buy buttons
     become one "Use my gift", and the order posts /rp-gift/redeem instead of a
     plain order. ?gift=1 is the old January design flag, not a card. */
  var GIFT = null;
  var LOCK_IDS = { place: ['rp-place', 'rp-go'], year: ['rp-year'], station: ['rp-station'], style: ['rp-style'], cmp: ['rp-cmp'], name: ['rp-name'],
    dedication: ['rp-ded'], markers: [1, 2, 3, 4, 5].reduce(function (a, i) { return a.concat(['rp-m' + i + 'mo', 'rp-m' + i + 'dy', 'rp-m' + i + 'l']); }, []).concat(['rp-add-day']), normals: ['rp-normals'], records: ['rp-records'],
    crop: ['rp-crop', 'rp-crop-plant', 'rp-crop-harvest', 'rp-plants', 'rp-ghost'], hist: ['rp-hist'], frost: ['rp-frost'], heat: ['rp-heat'], ribbon: ['rp-ribbon'],
    logo: ['rp-logo-file', 'rp-logo-remove', 'rp-logo-ink'] };
  function lockInput(field) {
    (LOCK_IDS[field] || []).forEach(function (id) {
      if (id === 'rp-style') { radios('rp-style').forEach(function (r) { r.disabled = true; }); return; }
      if (id === 'rp-logo-ink') { radios('rp-logo-ink').forEach(function (r) { r.disabled = true; }); return; }
      if (id === 'rp-logo-file') { var pk = $('rp-logo-pick'); if (pk) { pk.setAttribute('aria-disabled', 'true'); pk.style.pointerEvents = 'none'; pk.style.opacity = '.55'; } }
      var el = $(id); if (el) { el.disabled = true; el.setAttribute('data-gift-lock', '1'); }
    });
  }
  function syncGiftUse() {
    var on = !!(GIFT && GIFT.usable);
    $('rp-gift-use-wrap').hidden = !on;
    // a card covers one product: no picker, no price button, the card's own button instead
    doc.querySelectorAll('#rp-prods, .rp-box-d, #rp-pay-wrap, #rp-gift-line, #rp-isgift-wrap').forEach(function (el) { if (on) el.hidden = true; });
    syncBar();
    if (!on) return;
    $('rp-gift-use-note').textContent = 'Your card covers ' + root.AgRpGift.product(GIFT.product) + '.' + (canOrder() ? '' : ' Draw the print above first.');
    $('rp-gift-use').disabled = !canOrder();
  }
  function useGift() {
    if (!GIFT || !GIFT.usable) return;
    if (!canOrder()) { checkIt(); return; }
    syncGift();
    openOrder(GIFT.product);
    $('ro-choice').disabled = true;
    $('ro-submit').textContent = 'Use my gift';
  }
  function giftStart() {
    var A = root.AgRpGift;
    if (!A || typeof A.fromUrl !== 'function') return;
    var gc = A.fromUrl();
    if (!gc) return;
    A.open(gc, { banner: $('rp-gift-banner'), onChange: takeGift }).then(takeGift);
  }
  function takeGift(g) {
    if (!g || !g.usable) return;
    GIFT = g;
    if (g.lock && g.lock.design) {
      // the name box keeps what the reader typed (it never holds the example's name: that is a gray hint)
      var typed = $('rp-name').value, keepName = g.lock.edit === 'name' && typed ? typed : null;
      ST = normalize(g.lock.design);
      // the card's town, not the reader's area: no "your area" line under it
      NEAR = '';
      if (keepName) ST.name = cleanText(printable(keepName), LIMITS.name);
      if (SAMPLE) { SAMPLE = null; sampleLine(false); }
      writeInputs(ST);
      run();
    }
    (g.locked || []).forEach(lockInput);
    // the giver's design carries its logo, or none: it stays as they made it
    if (g.lock && g.lock.design) lockInput('logo');
    // a card's design is set: no example years to tap
    if (g.lock && g.lock.design) $('rp-stories').hidden = true;
    endExample();
    syncGiftUse();
    ga('rain_print_gift_open', { kind: g.kind || '' });
  }
  // rp-gift.js comes after this file; deferred, both run before DOMContentLoaded, so wait for it while the page is still parsing or running its deferred scripts
  if (doc.readyState === 'loading' || (doc.readyState === 'interactive' && !root.AgRpGift)) doc.addEventListener('DOMContentLoaded', giftStart); else giftStart();
})(typeof window !== 'undefined' ? window : this);
