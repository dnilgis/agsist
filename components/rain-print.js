/* components/rain-print.js: Rain Print by AGSIST (/rain-print), 2026-10-11.
 *
 * A place and a finished year become a print: every day's precipitation at
 * the nearest NOAA weather station with a usable record, drawn in one of the
 * two styles Sig picked (2026-10-13): R1 Staircase (the running total, the
 * default) or R2 Roots (snow piled above the ground line, rain soaking down
 * below it). components/rain-print-art.js draws both; this file feeds it.
 * Optional: a dedication line, NOAA's 30-year normal under each month's total,
 * and remarkable days (components/rain-print-records.js, loaded on first use).
 * The QR carries the short link (components/rp-short.js) once there is one.
 * The serial "No. 0001 · SRL" goes under it on Sig's print files only
 * (?maker=1&serial=1), never on the digital file or the public page.
 * Ported from Sig's standalone Rain Print Studio (the October last-pass
 * version, with its QR, marker, callout and dry-spell fixes); the art is his design.
 *
 * WHERE THE NUMBERS COME FROM (nothing here is invented or filled in)
 *   place     Open-Meteo geocoding (geocoding-api.open-meteo.com)
 *   stations  RCC-ACIS StnMeta, stations within about 0.6 degrees whose
 *             precipitation record spans the whole year
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
 * size, comparison, name, up to three dates) round-trips through the query
 * string, and through a short design code (?d=...) that the QR maker's mark,
 * Stripe's client_reference_id and the order form all carry. Open
 * /rain-print?d=<code> and the same print draws again.
 *
 * DOWNLOADS. The public button gives a watermarked preview PNG. /rain-print?maker=1
 * shows Sig's clean 300 dpi print files (12x18 in, 0.125 in bleed, so 12.25 x 18.25 in
 * and fits the 13 x 19 sheets his Epson takes),
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
 * PRODUCTS (2026-10-11): digital file, 12 x 18 print, 12 x 18 framed; Sig
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
  var LIMITS = { place: 32, name: 24, label: 13, markers: 3, dedication: 70 };
  /* The QR carries the short link (rp-short.js), which fits at any length; the
     long ?d= link it falls back to fits a typical design. The dedication went
     from 40 to 70 (2026-10-13) after the longest line was drawn at both styles.
     A code over Stripe's 200 characters goes to checkout as its short-link id
     (checkoutRef below). */
  var SITE = 'https://agsist.com/rain-print';

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
      style: 'r1', dedication: '', normals: false, records: false };
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
    return s;
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
     October 1 through the cutoff: "Order by Dec 12 for Christmas delivery."
     After it, through Dec 25: new orders ship after Christmas. Otherwise nothing.
     A plain date, never a countdown. */
  function cutoffNote(todayIso, cutoffIso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cutoffIso || ''));
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayIso || ''))) return '';
    if (todayIso < m[1] + '-10-01' || todayIso > m[1] + '-12-25') return '';
    if (todayIso <= cutoffIso) return 'Order by ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) + ' for Christmas delivery.';
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
    var n = parts.reduce(function (a, b) { return a + b; }, 0), by = year + '-12-24', hol = Array.isArray(j.holidays) ? j.holidays : [];
    var t = Date.parse(by + 'T12:00:00Z');
    for (var i = 0; i < 90; i++, t -= 86400000) {
      var d = new Date(t).toISOString().slice(0, 10);
      if (addBizDays(d, n, hol) <= by) return d;
    }
    return null;
  }
  function shortDate(iso) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[1] - 1] + ' ' + (+m[2]) : ''; }

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
  function bizRange(r) { return r.to === null ? r.from + ' or more' : r.from === r.to ? String(r.from) : r.from + '\u2013' + r.to; }
  /* Index of the last day that has a recorded value (v not null), or -1. A
     preview ends there: the days after it are not in yet, not dry. */
  function lastRecorded(days) {
    for (var i = (days || []).length - 1; i >= 0; i--) if (days[i] && days[i].v !== null && days[i].v !== undefined) return i;
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
  // A day whose own amount nobody knows: unrecorded, or rolled into a later A total.
  function unknownDay(x) { return x.v === null || x.v === undefined || x.flag === 'S'; }
  function derive(days) {
    var n = days.length, month = Array(12).fill(0), mdays = Array(12).fill(0), monthValid = Array(12).fill(0);
    var total = 0, wet = 0, missing = 0, trace = 0, unsplit = 0, max = { v: 0, date: '', doy: -1 };
    var dry = 0, dryStart = -1, dryMax = { len: 0, end: '', endDoy: -1, startDoy: -1 }, cum = [], over1 = 0;
    function endDry() { dry = 0; dryStart = -1; }
    days.forEach(function (x) {
      mdays[x.m]++;
      // An unrecorded day ends a dry run: nobody knows whether it rained.
      if (x.v === null || x.v === undefined) { missing++; endDry(); cum.push(total); return; }
      monthValid[x.m]++;
      // An S day is the same: its rain was real, but it is counted on the A day.
      if (x.flag === 'S') { unsplit++; endDry(); cum.push(total); return; }
      if (x.flag === 'T') { trace++; endDry(); cum.push(total); return; }
      total += x.v; month[x.m] += x.v; cum.push(total);
      if (x.v >= 1) over1++;
      if (x.v > 0) {
        wet++; endDry();
        // An A value is several days' catch, so it cannot be the wettest single day.
        if (x.flag !== 'A' && x.v > max.v) max = { v: x.v, date: x.date, doy: x.doy };
      }
      else if (x.s > 0) endDry();   // snow fell: not a dry day, whatever the gauge read (Sig)
      else { if (dry === 0) dryStart = x.doy; dry++; if (dry > dryMax.len) dryMax = { len: dry, end: x.date, endDoy: x.doy, startDoy: dryStart }; }
    });
    var validMonths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(function (i) { return monthValid[i] > 0; });
    var maxMonth = validMonths.length ? Math.max.apply(null, validMonths.map(function (i) { return month[i]; })) : 0;
    var maxDay = Math.max.apply(null, [0].concat(days.map(function (x) { return x.v || 0; })));
    // Snowfall prints only when the station kept a snowfall record nearly every day
    // (at most MISS_OK days without one) and some snow fell; otherwise it is left off.
    var snowTotal = 0, snowMissing = 0;
    days.forEach(function (x) { if (x.s === null || x.s === undefined) snowMissing++; else snowTotal += x.s; });
    var snow = snowMissing <= MISS_OK && snowTotal >= 0.1 ? Math.round(snowTotal * 10) / 10 : null;
    var hot = { v: null, date: '', doy: -1 }, cold = { v: null, date: '', doy: -1 };
    days.forEach(function (x) {
      if (x.t === null || x.t === undefined) return;
      if (hot.v === null || x.t > hot.v) hot = { v: x.t, date: x.date, doy: x.doy };
      if (cold.v === null || x.t < cold.v) cold = { v: x.t, date: x.date, doy: x.doy };
    });
    return { n: n, month: month, mdays: mdays, monthValid: monthValid, total: total, wet: wet, missing: missing, unsplit: unsplit, trace: trace, max: max, dryMax: dryMax, cum: cum, maxMonth: maxMonth, maxDay: maxDay, over1: over1, hot: hot, cold: cold, snow: snow };
  }
  // the same rule on both layouts
  function showDry(D) { return D.dryMax.len >= DRY_MIN; }
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
     still opens: as R1, or R2 if its layout was Waveform. Only the characters A-Z a-z 0-9 - _ so Stripe takes it
     as a client_reference_id (200 at most).
     A gift order (this year, delivered in January) is the same code with GIFT-
     in front, so Sig sees it in Stripe without decoding anything. A v1 code
     always starts with M (base64 of "1|"), so the prefix cannot be mistaken
     for part of a code. */
  var GIFT_PREFIX = 'GIFT-', XFLAG = 'abcdefgh';
  function encodeCode(x) {
    var s = normalize(x);
    if (!s.place || !s.year) return '';
    var x5 = XFLAG[(s.style === 'r2' ? 4 : 0) + (s.normals ? 1 : 0) + (s.records ? 2 : 0)];
    var f = ['2', s.place, s.station, String(s.year), LAYOUT[s.layout] + PALETTE[s.palette] + CMP[s.cmp] + SIZE[s.size] + x5, s.name];
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
    var k = f[4] || '', x5 = v2 ? XFLAG.indexOf(k[4]) : -1;
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
      style: v2 ? (x5 & 4 ? 'r2' : 'r1') : null, dedication: ded, normals: v2 && (x5 & 1) === 1, records: v2 && (x5 & 2) === 2 });
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
    return normalize({ place: q.get('place'), station: q.get('station'), year: q.get('year'), layout: q.get('layout'),
      palette: q.get('palette'), size: q.get('size'), cmp: q.get('cmp'), name: q.get('name'), markers: markers, gift: q.get('gift'),
      style: q.get('style'), dedication: q.get('dedication'), normals: q.get('normals'), records: q.get('records') });
  }
  function designUrl(x) { return SITE + '?' + toParams(x); }
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
    var zip = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(q);
    var parts = q.split(','), town = zip ? zip[1] : parts[0].trim(), st = zip ? '' : (parts[1] || '').trim().toLowerCase();
    return { zip: zip ? zip[1] : '', town: town, st: st };
  }
  function geoPick(q, results) {
    var g = geocodeQuery(q), list = (results || []).filter(function (x) { return x && typeof x.latitude === 'number' && typeof x.longitude === 'number' && x.name; });
    if (!list.length) return { error: g.zip ? 'Couldn\u2019t find ZIP ' + g.zip + '. Type the town and state instead, like Chetek, WI.' : 'Couldn\u2019t find "' + q + '". Check the spelling, and type a town and state, like Chetek, WI.' };
    if (g.zip) return { hit: list[0] };
    if (g.st) {
      var inSt = list.filter(function (x) { var a = String(x.admin1 || '').toLowerCase(); return a === STATE[g.st] || a === g.st; });
      if (!inSt.length) return { error: 'Couldn\u2019t find "' + parts0(q) + '" in ' + (STATE[g.st] ? toTitle(STATE[g.st]) : g.st.toUpperCase()) + '. Check the spelling of the town and the state.' };
      list = inSt;
    }
    // more than one town of that name, far enough apart to have different gauges: ask
    var far = list.filter(function (x, i) { return i === 0 || haversine(list[0].latitude, list[0].longitude, x.latitude, x.longitude) > 30; });
    if (far.length > 1) return { pick: far.slice(0, 6) };
    return { hit: list[0] };
  }
  function parts0(q) { return String(q).split(',')[0].trim(); }

  /* The reader's dates, checked against the year: [{i, msg}] for each date
     that won't print (2026-10-13: a date outside the year was dropped from the
     print with no word). */
  function dateProblems(year, dates) {
    var out = [];
    (dates || []).forEach(function (d, i) {
      if (!d) return;
      if (!year) return;
      if (dayIndex(year, d) < 0) out.push({ i: i, msg: 'Date ' + (i + 1) + ' (' + d + ') isn\u2019t in ' + year + ', so it won\u2019t be on the print. Pick a day in ' + year + '.' });
    });
    var seen = {};
    (dates || []).forEach(function (d, i) { if (d && dayIndex(year, d) >= 0) { if (seen[d] !== undefined) out.push({ i: i, msg: 'Dates ' + (seen[d] + 1) + ' and ' + (i + 1) + ' are the same day. Both labels print, one over the other.' }); else seen[d] = i; } });
    return out;
  }
  // label ideas offered under the date boxes; any words of the buyer's own work too
  var LABEL_PRESETS = ['Planted', 'Harvest done', 'Turnout', 'Calving', 'Weaning', 'First cutting', 'Hail', 'Wedding', 'Born', 'Moved in'];

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

  /* Why a share link can't be drawn, in words, or '' when it can (or there is no design in it). */
  function linkProblem(search) {
    var q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    if (q.get('d')) return decodeCode(q.get('d')) ? '' : 'That link\u2019s design code is damaged or cut short, so it can\u2019t be drawn. Below is a sample; type the town to draw your own.';
    if (q.has('year') && normalize({ year: q.get('year') }).year === null) return 'That link\u2019s year (' + cleanText(q.get('year'), 12) + ') isn\u2019t one we can draw. Pick a year from 1890 on and press Draw it.';
    if (q.has('year') && !cleanText(q.get('place'), LIMITS.place)) return 'That link has no town in it. Type the town and press Draw it.';
    return '';
  }

  // ---------- stations in plain words (pure) ----------
  /* "471667 2" is ACIS's id plus its network (2 = NOAA co-op); the page shows
     "NOAA co-op station 471667", never the raw pair. Names come in caps:
     "CAMERON 2 NE" reads "Cameron, 2 mi NE", "RICE LAKE MUNI AP" reads
     "Rice Lake Municipal Airport". */
  function sidPlain(sid) {
    var p = String(sid || '').trim().split(/\s+/);
    return (p[1] === '2' ? 'NOAA co-op station ' : 'NOAA station ') + p[0];
  }
  var STN_WORD = { AP: 'Airport', MUNI: 'Municipal', INTL: 'International', RGNL: 'Regional', CO: 'County', FLD: 'Field', ARPT: 'Airport', STN: 'Station', EXP: 'Experiment', AG: 'Ag' };
  function stationName(raw) {
    var s = String(raw || '').trim().replace(/\s+/g, ' ');
    var off = /^(.*?) (\d+(?:\.\d+)?) ?([NSEW]{1,3})$/.exec(s), tail = '';
    if (off) { s = off[1]; tail = ', ' + off[2] + ' mi ' + off[3]; }
    return s.split(' ').map(function (w) {
      var u = w.toUpperCase();
      if (STN_WORD[u]) return STN_WORD[u];
      if (/^[NSEW]{1,3}$/.test(u) || /\d/.test(w)) return u;
      return u.charAt(0) + u.slice(1).toLowerCase();
    }).join(' ') + tail;
  }
  function milesText(mi) { return mi < 0.1 ? 'under 0.1 mi' : (mi < 10 ? mi.toFixed(1) : String(Math.round(mi))) + ' mi'; }

  var api = { encodeCode: encodeCode, decodeCode: decodeCode, toParams: toParams, fromParams: fromParams,
    designUrl: designUrl, shortUrl: shortUrl, normalize: normalize, defaults: defaults, dayIndex: dayIndex, LIMITS: LIMITS, STYLES: Object.keys(STYLE),
    chicagoToday: chicagoToday, yearMode: yearMode, lastRecorded: lastRecorded, cutoffNote: cutoffNote, GIFT_PREFIX: GIFT_PREFIX,
    bizCutoffNote: bizCutoffNote, christmasCutoff: christmasCutoff, addBizDays: addBizDays, shortDate: shortDate, bizRows: bizRows, bizRowFor: bizRowFor, bizRange: bizRange, bizQuote: bizQuote, bizQuoteMax: function (j) { return bizQuoteMax(j, bizTiers(j && j.business_tiers)); }, BIZ_MIN: BIZ_MIN, BIZ_MAX: BIZ_MAX,
    printable: printable, hasUnprintable: hasUnprintable, dateProblems: dateProblems, LABEL_PRESETS: LABEL_PRESETS, checkoutRef: checkoutRef, linkProblem: linkProblem, sidPlain: sidPlain, stationName: stationName, milesText: milesText, geoPick: geoPick, geocodeQuery: geocodeQuery, placeLabel: placeLabel,
    parsePcpn: parsePcpn, derive: derive, showDry: showDry, DRY_MIN: DRY_MIN, overlayDaily: overlayDaily, stairPath: stairPath, riserSpan: riserSpan };
  root.RainPrint = api;
  if (!root.document || !root.document.getElementById('rp-form')) return;

  // ---------------------------------------------------------------- the page
  var doc = root.document;
  var $ = function (id) { return doc.getElementById(id); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* Print sizes, landscape: trim width and height in inches. The art is 1800 x 1200 units, 100 to the inch. */
  var PRINT = { '12x18': { w: 18, h: 12, label: '12 x 18 in' } };
  var ART_UNITS_IN = 100, BLEED_IN = 0.125, DPI = 300;
  var MISS_BLOCK = 31;   // more than a month unrecorded: no print, the page says why
  var TODAY = chicagoToday();                     // YYYY-MM-DD in Chetek's time zone
  var CURRENT_YEAR = parseInt(TODAY.slice(0, 4), 10);
  var GIFT_MIN_DAYS = 60;  // a gift preview needs the year recorded at least this far (to about March 1); less is too thin to draw fairly
  var STALE_DAYS = 30;     // this year: a station whose record stopped longer ago than this is not reporting, so it cannot make the print
  var MAKER = /(?:^|[?&])maker=1(?:&|$)/.test(root.location.search);
  var CHOICE = { digital: 'Digital file', print12x18: '12 x 18 print', framed12x18: '12 x 18 framed print' };
  var PRODUCTS = ['digital', 'print12x18', 'framed12x18'];
  var ORDER_TO = 'sig@farmers1st.com';

  var ST = fromParams(root.location.search);
  var DATA = null, META = null, EXT = null, NORM30 = null, STATIONS = [], PRICES = null, BLOCKED = '', DRAWING = false;
  /* This year only. PREVIEW: {last: ISO date of the last recorded day, yearLen}
     while a year-to-date preview is drawn. NOART: the plain message shown
     instead of art when the year so far is too thin to draw; ordering stays open. */
  var PREVIEW = null, NOART = '';
  /* SAMPLE (2026-10-11): with no design in the URL the page draws Chetek, WI
     for the last finished year, through the same geocode and ACIS calls a
     reader's own town takes, so the box is never empty. A sample cannot be
     ordered: the buy buttons stay off, nothing goes into the URL or the order
     form, and the town field stays empty, until the reader draws their own
     place or clicks "Use this design". Any failure puts the empty box back. */
  var SAMPLE = null;
  var EXT_CACHE = new Map(), NORM_CACHE = new Map(), DAILY_CACHE = new Map();

  function ga(n, p) { try { if (root.gaEvent) root.gaEvent(n, p); else if (root.gtag) root.gtag('event', n, p); } catch (e) {} }
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  // ---------- data ----------
  function miles(km) { return km * 0.621371; }

  /* Every outside call gives up after FETCH_MS (2026-10-13: a slow NOAA left
     "Looking for NOAA stations" up for good with Draw turned off). The error
     says who was slow; the status line then offers a Try again button. */
  var FETCH_MS = 15000;
  function safeFetch(url) {
    var who = /open-meteo/.test(url) ? 'The town lookup' : 'NOAA\u2019s data service';
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, timedOut = false;
    var timer = setTimeout(function () { timedOut = true; if (ctl) ctl.abort(); }, FETCH_MS);
    var slow = function () { var e = new Error(who + ' is slow right now and didn\u2019t answer in ' + (FETCH_MS / 1000) + ' seconds. Try again in a minute.'); e.retry = true; return e; };
    var race = new Promise(function (res, rej) { setTimeout(function () { if (!ctl) rej(slow()); }, FETCH_MS + 50); });
    var f = fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) { var e = new Error(who + ' didn\u2019t answer (error ' + r.status + '). Try again in a minute.'); e.retry = true; throw e; }
      return r;
    }, function () {
      clearTimeout(timer);
      if (timedOut) throw slow();
      var e = new Error(who + ' couldn\u2019t be reached. Check the connection and try again.'); e.retry = true; throw e;
    });
    return Promise.race([f, race]);
  }
  var PICKED = null;   // {q, hit}: the town the reader chose from a "which one?" list
  function geocode(q) {
    if (PICKED && PICKED.q === q) return Promise.resolve(PICKED.hit);
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
  function stations(lat, lon, year) {
    var d = 0.6;
    var u = 'https://data.rcc-acis.org/StnMeta?' + new URLSearchParams({
      bbox: [lon - d, lat - d, lon + d, lat + d].map(function (x) { return x.toFixed(3); }).join(','),
      elems: 'pcpn', sdate: year + '-01-01', edate: lastDayOf(year), meta: 'name,sids,ll,valid_daterange,state'
    });
    // This year: the record must reach back to Jan 1 and still be current.
    var y0 = year + '-01-01', y1 = year === CURRENT_YEAR ? isoMinusDays(TODAY, STALE_DAYS) : year + '-12-31';
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
      return (j.meta || []).filter(function (m) { return m.ll && m.sids && m.sids[0] && m.valid_daterange && m.valid_daterange[0] && m.valid_daterange[0][0] <= y0 && m.valid_daterange[0][1] >= y1; })
        .map(function (m) { return Object.assign({}, m, { sid: cleanSid(m.sids[0]), km: haversine(lat, lon, m.ll[1], m.ll[0]) }); })
        .sort(function (a, b) { return a.km - b.km; });
    });
  }
  function parseTemp(raw) { var s = String(raw).trim(); if (s === 'M' || s === '') return null; var v = parseFloat(s); return isNaN(v) ? null : v; }
  // pcpn, avgt (daily mean temperature, F), snow, maxt and mint come back as parallel columns from one
  // call; the raw rows are kept for the remarkable-days layer (components/rain-print-records.js)
  function daily(sid, year) {
    var key = sid + '|' + year;
    if (DAILY_CACHE.has(key)) return Promise.resolve(DAILY_CACHE.get(key));
    var u = 'https://data.rcc-acis.org/StnData?' + new URLSearchParams({ sid: sid, sdate: year + '-01-01', edate: lastDayOf(year), elems: 'pcpn,avgt,snow,maxt,mint', meta: 'name,state,ll' });
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error || !Array.isArray(j.data)) throw new Error('That station has no rain record for this year. Pick another one under Weather station.');
      var days = [];
      j.data.forEach(function (row) {
        // snow: NOAA's separate snowfall record (inches of snow as it fell). pcpn already
        // counts that snow melted down to water, so snowfall is shown beside it, never added.
        var p = parsePcpn(row[1]), t = row[2] !== undefined ? parseTemp(row[2]) : null, sn = row[3] !== undefined ? parsePcpn(row[3]).v : null;
        var dt = new Date(row[0] + 'T00:00:00');
        days.push({ date: row[0], v: p.v, flag: p.flag, t: t, s: sn, m: dt.getMonth(), d: dt.getDate(), doy: days.length });
      });
      // This year: stop at the last recorded day. The days after it have not
      // come in yet (NOAA's daily numbers lag a few days); they are not gaps.
      if (year === CURRENT_YEAR) days = days.slice(0, lastRecorded(days) + 1);
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
    return safeFetch(u).then(function (r) { return r.json(); }).then(function (j) {
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
      return ext;
    });
  }
  // NOAA's 30-year normal for each date, from ACIS's own normal element (period
  // not verified live, so never printed). A station without a normals product
  // fails here and the comparison says so.
  function stationNormal(sid, year) {
    var key = sid + '|' + year;
    if (NORM_CACHE.has(key)) return Promise.resolve(NORM_CACHE.get(key));
    var params = JSON.stringify({ sid: sid, sdate: year + '-01-01', edate: year + '-12-31', elems: [{ name: 'pcpn', normal: 1 }] });
    return safeFetch('https://data.rcc-acis.org/StnData?params=' + encodeURIComponent(params)).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error || !Array.isArray(j.data)) throw new Error(j.error || 'no data');
      var byDate = new Map();
      j.data.forEach(function (row) { var v = parsePcpn(row[1]).v; if (v !== null) byDate.set(row[0].slice(5), v); });
      NORM_CACHE.set(key, byDate);
      return byDate;
    });
  }

  // ---------- derived ----------
  function overlayKey() { return ST.cmp === 'normal' ? 'normal30' : ST.cmp === 'station' ? 'full' : ''; }
  // The chosen comparison as daily amounts + running total, aligned to the year, or null.
  function overlaySeries() {
    var key = overlayKey();
    if (!key || !DATA) return null;
    var byDate, label;
    if (key === 'normal30' && NORM30) { byDate = NORM30; label = 'NOAA 30-year normal'; }
    else if (key === 'full' && EXT && EXT.avgByDate.size) { byDate = EXT.avgByDate; label = EXT.yearFrom + '–' + EXT.yearTo + ' station average (' + EXT.years + ' yrs)'; }
    else return null;
    var o = overlayDaily(DATA.days, byDate);
    if (!o) return null;
    o.label = label;
    return o;
  }
  // ---------- the art (components/rain-print-art.js draws it) ----------
  function fmtDate(iso) { if (!iso) return ''; var p = iso.split('-').map(Number); return MON[p[1] - 1].toUpperCase() + ' ' + p[2]; }
  function printMarkers() {
    if (!DATA) return [];
    return ST.markers.map(function (m) {
      var doy = dayIndex(META.year, m.date);
      var p = m.date.split('-').map(Number);
      return doy >= 0 && doy < DATA.d.n ? { doy: doy, label: m.label || MON[p[1] - 1] + ' ' + p[2] } : null;
    }).filter(Boolean);
  }
  // "Chetek, Wisconsin": the state written out on the print
  function placeLong() {
    var full = STATE[String(META.stateAbbr || '').toLowerCase()];
    return META.city + ', ' + (full ? toTitle(full) : (META.stateAbbr || META.state || ''));
  }

  /* The maker's mark: a real QR code (components/qr.js, level M), square to the
     page, warm gray on the paper. It carries the short link
     (components/rp-short.js, 25 x 25 modules) once the worker has given one, and
     the long ?d= link until then or if it never does. */
  var QR_OK = true;
  // The design itself, without the gift marker: what the QR and shared links open.
  function artDesign() { return Object.assign({}, ST, { gift: false }); }
  var SHORT_WANT = '';
  function qrLink() {
    var d = artDesign(), code = encodeCode(d), hit = null;
    if (!code) return '';
    if (root.AgRpShort && !SAMPLE) {
      hit = root.AgRpShort.peek(code);
      if (!hit && SHORT_WANT !== code) {
        SHORT_WANT = code;
        root.AgRpShort.getShortLink(code).then(function (link) {
          // redraw only if the design is still the one asked about
          if (link && DATA && !BLOCKED && encodeCode(artDesign()) === code) render();
        });
      }
    }
    return hit || shortUrl(d);
  }
  function qrInfo(serial) {
    var url = qrLink(), m = null;
    QR_OK = false;
    if (!root.AgQR || !url) return null;
    try { m = root.AgQR.matrix(url); } catch (e) { return null; }
    QR_OK = true;
    return { matrix: m, serial: serial || '' };
  }
  /* The serial goes under the QR on a physical print only: Sig's print files
     with ?maker=1&serial=N. Never on the digital file, never on the public page. */
  var SERIAL = (function () {
    var m = /(?:^|[?&])serial=(\d{1,6})(?:&|$)/.exec(root.location.search);
    return MAKER && m && +m[1] > 0 ? 'No. ' + String(+m[1]).padStart(4, '0') + ' · SRL' : '';
  })();

  function cmpNote() {
    if (ST.cmp === 'normal') return 'Usual = 30-year normal';
    if (ST.cmp === 'station' && EXT) return 'Usual = this station’s average, ' + EXT.yearFrom + ' to ' + EXT.yearTo;
    return '';
  }
  /* o: {bleed (art units, 100 to the inch), watermark, px [w,h], fontCss, serial, idPrefix}. */
  function buildSvg(o) {
    o = o || {};
    var input = {
      style: ST.style, year: META.year, place: placeLong(), name: ST.name, dedication: ST.dedication,
      days: DATA.days, D: DATA.d, showDry: showDry(DATA.d), axisLen: PREVIEW ? PREVIEW.yearLen : DATA.d.n,
      ov: overlaySeries(), ovNote: cmpNote(), showNormals: ST.normals, markers: printMarkers(),
      records: ST.records ? recordsFor() : [], qr: qrInfo(o.serial), preview: PREVIEW ? { last: PREVIEW.last } : null,
      gauge: META ? gaugeLine(META) : '',
      watermark: !!o.watermark, bleed: o.bleed || 0, px: o.px, fontCss: o.fontCss, idPrefix: o.idPrefix
    };
    var svg = root.AgRainArt.render(input);
    SKIPPED = root.AgRainArt.lastSkipped();
    return svg;
  }

  /* Remarkable days (opt-in): components/rain-print-records.js reads the year's
     daily rows and the period of record this page already downloaded. Loaded on
     first use. */
  var SKIPPED = [], RECS_KEY = '', RECS = [], RECS_P = null;
  function recordsReady() {
    if (root.AgRainRecords) return Promise.resolve(true);
    if (RECS_P) return RECS_P;
    RECS_P = new Promise(function (res) {
      var sc = doc.createElement('script');
      sc.src = '/components/rain-print-records.js?v=1';
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
    return RECS;
  }

  // ---------------------------------------------------------------- UI
  var form = $('rp-form'), statusEl = $('rp-status'), art = $('rp-art');
  function setStatus(msg, bad) { if (SAMPLE) return; statusEl.textContent = msg; statusEl.classList.toggle('rp-bad', !!bad); }
  var EMPTY_ART = art.innerHTML, EMPTY_STATUS = statusEl.textContent, EMPTY_CAP = $('rp-sample-txt').textContent;
  // The line under the frame: what is hanging there.
  function sampleLine(on) {
    $('rp-sample-line').hidden = !on;
    var t = EMPTY_CAP;
    if (on) t = 'Sample: ' + SAMPLE.place + ', ' + SAMPLE.year + '.';
    else if (DATA && META && !BLOCKED) t = META.place + ', ' + META.year + (PREVIEW ? ', preview through ' + longDate(PREVIEW.last) : '') + '. ' + ($('rp-wall').getAttribute('data-view') === 'print' ? '12 x 18 print.' : '12 x 18, framed.');
    $('rp-sample-txt').textContent = t;
  }
  // Framed or print only: the same art, with or without the CSS frame.
  function setView(v) {
    $('rp-wall').setAttribute('data-view', v);
    doc.querySelectorAll('.rp-view .chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v)); });
    sampleLine(!!SAMPLE);
  }
  // After the reader's own draw, bring the frame into view if it is above the screen.
  function showArt() {
    var w = $('rp-wall');
    try { if (w.getBoundingClientRect().top < 0) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }
  // Back to the page as it loads with no design: the empty box and the first instruction.
  function clearSample() {
    if (!SAMPLE) return;
    SAMPLE = null;
    DATA = null; PREVIEW = null; NOART = ''; BLOCKED = '';
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
  function runSample() {
    SAMPLE = { place: 'Chetek, WI', year: lastFullYear() };
    art.innerHTML = '<p class="rp-placeholder">Drawing a sample from NOAA records…</p>';
    run(null, normalize({ place: SAMPLE.place, year: SAMPLE.year, size: '12x18', cmp: 'normal', name: '', markers: [], style: pick('rp-style', 'r1') }));
  }
  function useSample() {
    if (!SAMPLE || !DATA) return;
    SAMPLE = null;
    sampleLine(false);
    writeInputs(ST);
    setDesignRefs();
    showBuy(true);
    sampleLine(false);
    setStatus('This is the ' + ST.place + ', ' + ST.year + ' design now. Change what you like, or order it below.');
  }
  function radios(name) { return Array.prototype.slice.call(doc.querySelectorAll('input[name="' + name + '"]')); }
  function pick(n, dflt) { var r = radios(n).find(function (x) { return x.checked; }); return r ? r.value : dflt; }
  function readInputs() {
    var markers = [];
    for (var i = 1; i <= 3; i++) {
      var d = $('rp-m' + i + 'd').value, l = $('rp-m' + i + 'l').value;
      if (d) markers.push({ date: d, label: l });
    }
    // layout and palette are not on the page any more; they ride along so an old link keeps its code
    return normalize({ place: $('rp-place').value, year: $('rp-year').value, station: ST.station,
      layout: ST.layout, palette: ST.palette, size: '12x18', style: pick('rp-style', 'r1'),
      cmp: $('rp-cmp').value, name: $('rp-name').value, dedication: $('rp-ded').value, markers: markers,
      normals: $('rp-normals').checked, records: $('rp-records').checked });
  }
  // The year list: this year first (a gift, delivered in January), then every finished year.
  function giftYearLabel() { return fill((PRICES && PRICES.gift_year_label) || '{year}, as a gift (delivered in January)'); }
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
    for (var i = 1; i <= 3; i++) {
      var m = s.markers[i - 1];
      $('rp-m' + i + 'd').value = m ? m.date : '';
      $('rp-m' + i + 'l').value = m ? m.label : '';
    }
    syncMarkerBounds();
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
  function syncCounts() {
    [['rp-name', 'rp-name-n', LIMITS.name], ['rp-ded', 'rp-ded-n', LIMITS.dedication]].forEach(function (x) {
      var n = $(x[0]).value.length, el = $(x[1]);
      el.textContent = n >= x[2] ? n + ' of ' + x[2] + ' letters. That\u2019s the most that fits.' : n + ' of ' + x[2] + ' letters';
      el.classList.toggle('rp-at', n >= x[2]);
    });
  }
  function syncDates() {
    var y = parseInt($('rp-year').value, 10), ds = [1, 2, 3].map(function (i) { return $('rp-m' + i + 'd').value; });
    var probs = dateProblems(y, ds), el = $('rp-date-msg');
    [1, 2, 3].forEach(function (i) { $('rp-m' + i + 'd').setAttribute('aria-invalid', String(probs.some(function (p) { return p.i === i - 1 && /isn\u2019t in/.test(p.msg); }))); });
    el.textContent = probs.map(function (p) { return p.msg; }).join(' ');
    el.hidden = !probs.length;
  }
  function syncMarkerBounds() {
    var y = parseInt($('rp-year').value, 10);
    for (var i = 1; i <= 3; i++) {
      var el = $('rp-m' + i + 'd');
      if (y) { el.min = y + '-01-01'; el.max = y + '-12-31'; }
    }
  }
  function updateUrl() {
    if (SAMPLE) return;   // a sample never goes into the address bar
    var q = toParams(ST) + (MAKER ? '&maker=1' + (SERIAL ? '&serial=' + SERIAL.replace(/\D/g, '') : '') : '');
    try { root.history.replaceState(null, '', root.location.pathname + '?' + q); } catch (e) {}
  }

  function showBuy(on) {
    on = on && !SAMPLE;
    // Before anything of the reader's is drawn the buttons stay live and point at the town box; a station with too many gaps turns them off.
    var off = !!BLOCKED || DRAWING;
    $('rp-buy').classList.toggle('rp-off', off);
    doc.querySelectorAll('.rp-buy-btn').forEach(function (b) { b.disabled = off; });
    // why the buttons are off, in words, by the buttons
    var why = $('rp-buy-why');
    if (why) {
      why.textContent = DRAWING ? 'Drawing your print. Ordering opens when it is done.'
        : BLOCKED === 'failed' ? 'Ordering is off until your print draws. See the message by the town box above.'
        : BLOCKED ? 'Ordering is off: this station is missing too many days for a fair print. Pick another station or year above.' : '';
      why.hidden = !why.textContent;
    }
    $('rp-to-buy').classList.toggle('btn-primary', on);
    $('rp-to-buy').classList.toggle('btn-secondary', !on);
    $('rp-dl').disabled = !on || !DATA;
    $('rp-proof-open').disabled = !DATA || !!BLOCKED;
    // print files wait for the full year: a preview is never sent to the printer
    doc.querySelectorAll('#rp-maker button').forEach(function (b) { b.disabled = !on || !DATA || !!PREVIEW; });
    syncGift();
    if (typeof GIFT !== 'undefined' && GIFT) syncGiftUse();
  }

  // ---------- this year, as a gift ----------
  var GIFT_MSG_MAX = 240, GIFT_TO_MAX = 80;
  function fill(t) { return String(t || '').replace(/\{year\}/g, String(CURRENT_YEAR)).replace(/\{next\}/g, String(CURRENT_YEAR + 1)); }
  function giftMode() { return !!ST.year && yearMode(ST.year, TODAY) === 'gift'; }
  function canOrder() { return !SAMPLE && !BLOCKED && !DRAWING && (!!DATA || !!NOART); }
  function longDate(iso) { var p = String(iso).split('-').map(Number); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p[1] - 1] + ' ' + p[2]; }
  var ORDER_NOTE = '';
  function syncGift() {
    var on = giftMode() && canOrder();
    $('rp-gift').hidden = !on;
    if (!ORDER_NOTE) ORDER_NOTE = $('ro-order-note').textContent;
    $('ro-order-note').textContent = on ? 'Sig will email you within a day with a payment link. Nothing is charged until you pay it. The proof comes in January, once the full year is drawn.' : ORDER_NOTE;
    $('rp-preview-line').hidden = !(on && PREVIEW);
    syncAddress();
    syncCutoffs();
  }
  // Christmas lines on the print and framed cards. This year's gift ships in January anyway, so none show in gift mode.
  var CUTOFF_KEY = { print12x18: 'print_christmas_cutoff', framed12x18: 'framed_christmas_cutoff' };
  function syncCutoffs() {
    Object.keys(CUTOFF_KEY).forEach(function (id) {
      var el = $('rp-cut-' + id);
      if (!el) return;
      var t = giftMode() && canOrder() ? '' : cutoffNote(TODAY, PRICES && PRICES[CUTOFF_KEY[id]]);
      el.textContent = t;
      el.hidden = !t;
    });
  }

  /* The Christmas box by the town field and the line under the price cards:
     the order-by dates from data/rain-print.json, and what they allow for. */
  function syncXmas() {
    var J = PRICES || {}, pc = J.print_christmas_cutoff, fc = J.framed_christmas_cutoff;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pc || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fc || '')) return;
    var past = $('rp-xmas-past'), why = $('rp-xmas-why'), late = TODAY > pc && TODAY > fc;
    if (TODAY > pc.slice(0, 4) + '-12-25' || TODAY < pc.slice(0, 4) + '-10-01') return;
    past.textContent = late ? 'Past years ordered now ship after Christmas.'
      : 'Any past year can be there by Christmas: order a print by ' + shortDate(pc) + ' or a framed print by ' + shortDate(fc) + '.';
    if (Number.isInteger(J.ship_business_days) && J.transit_business_days) {
      why.textContent = 'The Christmas dates allow ' + (J.proof_business_days === 1 ? 'a business day' : J.proof_business_days + ' business days') + ' for the proof, ' +
        (J.approve_business_days === 1 ? 'one' : J.approve_business_days) + ' for you to OK it, ' + J.ship_business_days + ' to ship and the time in the mail, to arrive by Dec 24.';
      why.hidden = late;
    }
  }
  function distText(m) {
    return milesText(miles(m.km)) + ' from ' + m.city;
  }
  // "the Chetek, WI weather station, 0.4 mi from Chetek (NOAA co-op station 471667)"
  function gaugeWords(m) { return stationName(m.name) + ', ' + (m.state || m.stateAbbr) + ' weather station'; }
  function gaugeHtml(m) {
    return '<b>' + esc(gaugeWords(m)) + '</b>, ' + esc(distText(m)) + ' (' + esc(sidPlain(m.sid)) + ')' +
      (STATIONS.length > 1 ? ' <a href="#rp-station" class="rp-chg" id="rp-chg">Change station</a>' : '');
  }
  // the station line on the art itself: name and distance, both styles
  function gaugeLine(m) { return 'Rain gauge: ' + gaugeWords(m) + ', ' + distText(m); }
  function usualWords() {
    if (ST.cmp === 'normal') return 'A usual year here means NOAA\u2019s 30-year normal for this station, counted only on the days it reported.';
    if (ST.cmp === 'station' && EXT) return 'A usual year here means this station\u2019s own average, ' + EXT.yearFrom + ' to ' + EXT.yearTo + ', counted only on the days it reported.';
    return '';
  }
  function setDesignRefs() {
    if (SAMPLE) { $('rp-code-wrap').hidden = true; $('ro-design').value = ''; return; }
    var code = encodeCode(ST);
    $('rp-code').textContent = code;
    $('rp-code-wrap').hidden = !code;
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
    $('rp-source').innerHTML = 'The print will come from the ' + gaugeHtml(m) +
      '. Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>.';
    setDesignRefs();
    showBuy(true);
  }

  function render() {
    if (!DATA || BLOCKED) return;
    // the maker sees the serial on screen; nobody else ever does
    art.innerHTML = buildSvg({ serial: SERIAL });
    art.classList.remove('rp-empty');
    // the phone's small copy, held at the top while typing (CSS shows it under 900 px only)
    var mini = $('rp-mini');
    if (mini && root.matchMedia && root.matchMedia('(max-width: 899px)').matches) { mini.innerHTML = buildSvg({ idPrefix: 'mn' }); mini.hidden = false; }
    var D = DATA.d, m = META, OV = overlaySeries();
    var dist = distText(m);
    var later = PREVIEW ? ST.markers.filter(function (x) { return x.date > PREVIEW.last; }).length : 0;
    if (PREVIEW) $('rp-preview-line').innerHTML = '<b>Preview through ' + esc(longDate(PREVIEW.last)) + '.</b> The print you get shows the full year.';
    $('rp-source').innerHTML = 'Rain gauge: the ' + gaugeHtml(m) + '. ' +
      (D.n - D.missing) + ' of ' + D.n + ' days recorded' + (PREVIEW ? ' so far, January 1 through ' + esc(longDate(PREVIEW.last)) : '') + (D.missing ? '; the station sent no report on ' + D.missing + (D.missing === 1 ? ' day, left as a gap' : ' days, left as gaps') + ', not drawn as dry' : '') + '. ' +
      (D.unsplit ? D.unsplit + (D.unsplit === 1 ? ' day was' : ' days were') + ' reported together in a later total; that total is drawn on the day it was reported. ' : '') +
      (PREVIEW && OV ? 'The comparison covers the same days. ' : '') +
      (later ? (later === 1 ? 'Your date after ' : 'Your dates after ') + esc(longDate(PREVIEW.last)) + ' will be on the finished print. ' : '') +
      (usualWords() ? esc(usualWords()) + ' ' : '') +
      'Daily NOAA records through <a href="https://www.rcc-acis.org/" rel="noopener">RCC-ACIS</a>. ' +
      (QR_OK ? '' : ' <b>The name and labels are too long for the QR square, so it’s left off.</b> Shorten them and it comes back.') +
      (ST.records && PREVIEW ? ' Remarkable days are marked once the year is over.' : '') +
      (ST.records && !PREVIEW && root.AgRainRecords && !(EXT && EXT.rows) ? ' The station history didn’t load, so the year and month records are left off.' : '') +
      (ST.records && SKIPPED.length ? ' No room on the art for: ' + esc(SKIPPED.join('; ')) + '.' : '') +
      (ST.cmp !== 'none' && !OV ? ' <b>' + (ST.cmp === 'normal' ? 'This station has no NOAA normal, so there’s no comparison line.' : 'The station history didn’t load, so there’s no comparison line.') + '</b>' : '');
    var rows = [
      [PREVIEW ? 'Precipitation so far' : 'Precipitation', f2(D.total) + ' in (rain and melted snow)'],
      ['Snowfall', D.snow !== null && D.snow !== undefined ? D.snow.toFixed(1) + ' in' : 'no full snowfall record at this station'], ['Wet days', D.wet], ['Longest dry spell', D.dryMax.len + ' days'],
      ['Wettest day', D.max.v > 0 ? fmtDate(D.max.date) + ', ' + f2(D.max.v) + ' in' : D.wet ? 'not known (rain reported only as multi-day totals)' : 'no measurable rain'],
      ['Trace days', D.trace], ['Days with no report', D.missing],
      ['Compared with', OV ? OV.label + ', ' + f2(OV.total) + ' in' + (PREVIEW ? ' (same days)' : '') : 'nothing']
    ];
    $('rp-stats').innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(String(r[1])) + '</dd></div>'; }).join('');
    $('rp-stats-wrap').hidden = false;
    setDesignRefs();
    showBuy(true);
    sampleLine(!!SAMPLE);
    if (!$('rp-order').hidden) syncSummary();
    if ($('rp-proof').open) proofRender();
  }

  function blockPrint(msg) {
    if ($('rp-mini')) $('rp-mini').hidden = true;
    BLOCKED = msg;
    PREVIEW = null; NOART = '';
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
  function failDraw(err) {
    if ($('rp-mini')) $('rp-mini').hidden = true;
    DATA = null; META = null; PREVIEW = null; NOART = ''; EXT = null; NORM30 = null;
    BLOCKED = 'failed';
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
    setStatus(err && err.message ? err.message : 'The print didn\u2019t draw. Try again. If it fails twice, try another town or year.', true);
    $('rp-retry-row').hidden = !(err && err.retry);
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
        box.hidden = true;
        run({ type: 'submit', preventDefault: function () {} });
      });
      box.appendChild(b);
    });
    box.hidden = false;
    try { box.querySelector('button').focus(); } catch (e) {}
  }

  var reqToken = 0;
  function run(e, preset) {
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
    var my = ++reqToken;
    ST = next;
    var go = $('rp-go'), sel = $('rp-station');
    go.disabled = true; sel.disabled = true;
    BLOCKED = ''; DRAWING = true;
    $('rp-retry-row').hidden = true;
    if (!preset) $('rp-pick').hidden = true;
    showBuy(!!DATA);
    var g, chosen, picked, autoPick = false;
    var done = function () { if (my === reqToken) { DRAWING = false; go.disabled = go.hasAttribute('data-gift-lock'); sel.disabled = STATIONS.length < 2 || sel.hasAttribute('data-gift-lock'); showBuy(canOrder()); } };
    Promise.resolve().then(function () {
      if (!ST.place) throw new Error('Type a town and state, like Chetek, WI.');
      if (!ST.year) throw new Error('Pick a year.');
      var mode = yearMode(ST.year, TODAY);
      if (mode === 'future') throw new Error(ST.year + ' hasn\u2019t happened yet. Pick ' + CURRENT_YEAR + ' to give this year as a gift, or an earlier year.');
      ST.gift = mode === 'gift';
      setStatus('Finding ' + ST.place + '…');
      return geocode(ST.place);
    }).then(function (res) {
      if (my !== reqToken) throw 'stale';
      g = res;
      // a ZIP or a picked town: the print, the link and the order name the town found
      if (geocodeQuery(ST.place).zip) { ST.place = cleanText(placeLabel(g), LIMITS.place); $('rp-place').value = ST.place; }
      setStatus('Looking for NOAA stations near ' + g.name + ', ' + g.admin1 + '…');
      return stations(g.latitude, g.longitude, ST.year);
    }).then(function (list) {
      if (my !== reqToken) throw 'stale';
      STATIONS = list;
      if (!list.length) throw new Error(ST.gift ? 'No NOAA station within about 40 miles of ' + g.name + ' has a ' + ST.year + ' record from January 1 on. Try a bigger town nearby.'
        : 'No NOAA station within about 40 miles of ' + g.name + ' has all of ' + ST.year + ' on record. Try a bigger town nearby, or another year.');
      var want = list.find(function (s) { return s.sid === ST.station; });
      if (want) { chosen = want; return daily(want.sid, ST.year).then(function (d) { picked = d; }); }
      // Nearest first; take the first of three with a near-complete year, else the most complete.
      autoPick = true;
      var tries = list.slice(0, 3), best = null, bestSt = null, i = 0;
      var step = function () {
        if (i >= tries.length) { picked = best; chosen = bestSt; return null; }
        var s = tries[i++];
        setStatus('Reading ' + toTitle(s.name) + ' for ' + ST.year + '…');
        return daily(s.sid, ST.year).then(function (d) {
          if (!best || d.d.missing < best.d.missing) { best = d; bestSt = s; }
          if (d.d.missing <= MISS_OK) { picked = d; chosen = s; return null; }
          return step();
        }, function () { return step(); });
      };
      return step();
    }).then(function () {
      if (my !== reqToken) throw 'stale';
      // This year with nothing back yet: the station is still the one for the print, so ordering stays open.
      if (!picked && ST.gift) { chosen = STATIONS[0]; picked = { meta: {}, days: [], d: derive([]) }; }
      if (!picked) throw new Error('None of the stations near ' + g.name + ' sent back ' + ST.year + '. Try again in a minute.');
      ST.station = chosen.sid;
      sel.innerHTML = STATIONS.map(function (s) {
        return '<option value="' + esc(s.sid) + '">' + esc(stationName(s.name)) + ', ' + milesText(miles(s.km)) + ' away, record ' + s.valid_daterange[0][0].slice(0, 4) + '–' + s.valid_daterange[0][1].slice(0, 4) + '</option>';
      }).join('');
      sel.value = chosen.sid;
      var stateAbbr = abbrFor((g.admin1 || '').toLowerCase()) || picked.meta.state || '';
      META = { name: picked.meta.name || chosen.name, state: picked.meta.state || chosen.state || '', stateAbbr: stateAbbr, year: ST.year, km: chosen.km, place: g.name + ', ' + (stateAbbr || g.admin1), city: g.name, sid: chosen.sid };
      if (picked.d.missing > MISS_BLOCK) {
        DATA = null;
        blockPrint(stationName(META.name) + ' has ' + picked.d.missing + ' unrecorded days in ' + ST.year + '. They would print as dry spells that may not have been dry. ' +
          (!autoPick && STATIONS.length > 1 ? 'Pick another station under Weather station, or another year.' : 'None of the ' + Math.min(3, STATIONS.length) + ' nearest stations has a full ' + ST.year + '. Try another year, or a bigger town nearby.'));
        throw 'blocked';
      }
      if (ST.gift && picked.days.length < GIFT_MIN_DAYS) {
        DATA = null; PREVIEW = null;
        NOART = (picked.days.length ? 'This station only has ' + ST.year + ' through ' + longDate(picked.days[picked.days.length - 1].date) + ', too little to draw a fair preview. ' : 'No days of ' + ST.year + ' have come in from this station yet. ') +
          'You can still order it as a gift. The full-year print is drawn and sent in January.';
        renderNoArt();
        setStatus('No preview yet, but you can still order it.');
        throw 'noart';
      }
      DATA = { days: picked.days, d: picked.d, raw: picked.raw }; NOART = '';
      PREVIEW = ST.gift ? { last: picked.days[picked.days.length - 1].date, yearLen: isLeap(ST.year) ? 366 : 365 } : null;
      setStatus('Reading the full record at ' + toTitle(META.name) + '…');
      return Promise.all([
        stationExtremes(chosen.sid).catch(function () { return null; }),
        stationNormal(chosen.sid, ST.year).catch(function () { return null; })
      ]);
    }).then(function (res) {
      if (my !== reqToken) throw 'stale';
      EXT = res[0]; NORM30 = res[1];
      var D = DATA.d;
      setStatus('Drawn from ' + (D.n - D.missing) + ' days at ' + toTitle(META.name) + '.' + '' +
        (PREVIEW ? ' Preview through ' + longDate(PREVIEW.last) + '.' : ''));
      render();
      if (SAMPLE) setStatus(EMPTY_STATUS);
      else { ga('rain_print_draw', { style: ST.style }); if (e) showArt(); }
      if (ST.records) recordsReady().then(function (ok) { if (ok && DATA && my === reqToken) render(); });
    }).catch(function (err) {
      if (err === 'stale') return;
      if (SAMPLE) { if (my === reqToken) clearSample(); return; }   // the sample failed: the empty box, quietly
      if (err === 'blocked' || err === 'noart') return;
      if (my !== reqToken) return;
      failDraw(err);
    }).then(done);
  }

  function restyle() {
    var next = readInputs();
    if (SAMPLE) { next.place = ST.place; next.year = ST.year; }   // style choices try out on the sample
    next.station = ST.station;
    next.gift = ST.gift;
    var yearChanged = next.year !== ST.year, placeChanged = next.place !== ST.place;
    if (yearChanged || placeChanged) { syncMarkerBounds(); return; }
    ST = next;
    if (ST.records && !root.AgRainRecords) recordsReady().then(function (ok) { if (ok) render(); });
    render();
  }

  // ---------- prices and buying ----------
  function money(n) { return '$' + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(n)); }
  function loadPrices() {
    return fetch('/data/rain-print.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || typeof j.digital !== 'number') return;
      PRICES = j;
      PRODUCTS.forEach(function (id) {
        var el = doc.querySelector('[data-price="' + id + '"]');
        if (el && typeof j[id] === 'number') el.textContent = money(j[id]);
      });
      if (j.ships_within) $('rp-ships').textContent = j.ships_within;
      if (j.gift_delivery) $('rp-gift-delivery').textContent = fill(j.gift_delivery);
      // reprint_fee (null or dollars): shown after "a small fee" in the refund FAQ only when set (Sig, 2026-10-13)
      if (typeof j.reprint_fee === 'number' && j.reprint_fee > 0) {
        Array.prototype.forEach.call(doc.querySelectorAll('details p'), function (p) {
          if (p.innerHTML.indexOf('a small fee,') >= 0) p.innerHTML = p.innerHTML.replace('a small fee,', 'a small fee (' + money(j.reprint_fee) + '),');
        });
      }
      syncCutoffs();
      syncXmas();
      var o = $('rp-year').querySelector('option[value="' + CURRENT_YEAR + '"]');
      if (o) o.textContent = giftYearLabel();
      syncBiz();
      syncAddress();
    }).catch(function () {});
  }
  function payLink(id) {
    var l = PRICES && PRICES.payment_links && PRICES.payment_links[id];
    return typeof l === 'string' && /^https:\/\/[^\s"<>]+$/.test(l) ? l : '';
  }
  function buy(id) {
    if (!canOrder()) {
      // Nothing of the reader's is drawn yet (the sample, or an empty box): send them to the town box.
      if (BLOCKED) return;
      try { $('rp-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) {}
      try { $('rp-place').focus({ preventScroll: true }); } catch (err) {}
      statusEl.textContent = 'Type the town nearest the farm and press Draw it. The order carries the print you draw.';
      statusEl.classList.remove('rp-bad');
      return;
    }
    var code = refFor(), link = payLink(id), note = $('rp-buy-note');
    ga('rain_print_buy', { choice: id, via: link && code ? 'checkout' : 'form', gift: ST.gift ? 1 : giftTicked() ? 2 : 0 });
    // Stripe's client_reference_id takes A-Z a-z 0-9 - _ and at most 200 characters: the design code, or its short-link id when the code is longer
    if (link && code) {
      var u = link + (link.indexOf('?') >= 0 ? '&' : '?') + 'client_reference_id=' + code;
      root.open(u, '_blank', 'noopener');
      note.innerHTML = ST.gift
        ? 'Checkout opened in a new tab. Your design code is <code>' + esc(code) + '</code>; GIFT at the front tells Sig it is a gift for January. He emails you to confirm where it goes, and sends the proof once the full year is drawn.'
        : 'Checkout opened in a new tab. Your design code is <code>' + esc(code) + '</code>; it travels with the payment, and Sig emails a proof before printing.' +
          (giftTicked() ? ' Put their name and your note in the gift boxes there, and their address for shipping if it goes straight to them.' : '');
      return;
    }
    openOrder(id);
  }
  function shortHit() { return root.AgRpShort ? root.AgRpShort.peek(encodeCode(artDesign())) : null; }
  function shortRef() { var m = /\/R\?([0-9A-Z]{5,8})$/.exec(shortHit() || ''); return m ? 'RPS-' + m[1] : ''; }
  function refFor() { return checkoutRef(encodeCode(ST), ST.gift, shortHit()); }
  // the design code the order form sends: the code itself, or the short-link reference when the code is past the worker's 300
  function orderCode() { var c = encodeCode(ST); return c.length <= 300 ? c : (checkoutRef(c, ST.gift, shortHit()) || c); }
  /* The order summary at the top of the order form: what is ordered, the
     design in words, and exactly what happens next. Payment links are null
     today, so every order is a request Sig answers by email. */
  function designRows() {
    var rows = [['Place and year', (META ? META.place : ST.place) + ', ' + ST.year], ['Style', ST.style === 'r2' ? 'Roots' : 'Staircase'],
      ['Name', ST.name || '(none)'], ['Line under it', ST.dedication || '(none)']];
    rows.push(['Dates', ST.markers.length ? ST.markers.map(function (m) { return shortDate(m.date) + (m.label ? ' \u201c' + m.label + '\u201d' : ''); }).join(', ') : '(none)']);
    if (META) rows.push(['Rain gauge', gaugeWords(META) + ', ' + distText(META)]);
    rows.push(['Compared with', ST.cmp === 'normal' ? 'NOAA 30-year normal' : ST.cmp === 'station' ? 'the station\u2019s full record' : 'nothing']);
    return rows;
  }
  function syncSummary() {
    var el = $('ro-summary'), id = $('ro-choice').value, J = PRICES || {};
    if (!el || !canOrder()) { if (el) el.innerHTML = ''; return; }
    var price = typeof J[id] === 'number' ? money(J[id]) + (id === 'digital' ? '' : ', shipping included') : '';
    var jan = januaryGift(), print = id !== 'digital';
    var steps = jan
      ? ['Sig emails you within 1 business day with a payment link. Nothing is charged until you pay it.', 'In January, once NOAA\u2019s December numbers are in, he draws the full year and emails you the proof.', 'You OK the proof or ask for changes. Nothing prints before that.', print ? 'It ships within ' + (J.ship_business_days || 7) + ' business days after you OK it.' : 'The file is emailed once you OK it.']
      : ['Sig emails you a proof of this exact design within 1 business day, with a payment link.', 'You OK the proof or ask for changes. Nothing is charged until you pay the link, and nothing prints before you OK it.',
        print ? 'It ships within ' + (J.ship_business_days || 7) + ' business days after you OK the proof.' : 'The file is emailed within 1 business day after you pay.'];
    el.innerHTML = '<p><b>' + esc(CHOICE[id]) + (price ? ', ' + esc(price) : '') + '</b>' + (PROOF_OK === encodeCode(ST) ? ' &middot; you checked the proof' : ' &middot; <a href="#rp-proof" id="ro-see-proof">check the proof first</a>') + '</p>' +
      '<dl>' + designRows().map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      '<p><b>What happens next</b></p><ol>' + steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';
    var sp = $('ro-see-proof');
    if (sp) sp.addEventListener('click', function (ev) { ev.preventDefault(); openProof(); });
  }

  // ---------- the proof: the exact print file, full size ----------
  var PROOF_OK = '', PROOF_VIEW = 'print', PROOF_ZOOM = 'fit';
  function proofRender() {
    var dlg = $('rp-proof');
    if (!DATA || BLOCKED) { dlg.close && dlg.open && dlg.close(); return; }
    $('rp-proof-art').innerHTML = buildSvg({ idPrefix: 'pf', serial: SERIAL });
    dlg.setAttribute('data-view', PROOF_VIEW); dlg.setAttribute('data-zoom', PROOF_ZOOM);
    doc.querySelectorAll('[data-pstyle]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-pstyle') === ST.style)); });
    doc.querySelectorAll('[data-pview]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-pview') === PROOF_VIEW)); });
    doc.querySelectorAll('[data-pzoom]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-pzoom') === PROOF_ZOOM)); });
    $('rp-proof-sum').innerHTML = designRows().map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') +
      (PREVIEW ? '<div><dt>Preview</dt><dd>through ' + esc(longDate(PREVIEW.last)) + '; the print shows the full year</dd></div>' : '');
    $('rp-proof-ok').checked = PROOF_OK === encodeCode(ST);
  }
  function openProof() {
    if (!DATA || BLOCKED) return;
    var dlg = $('rp-proof');
    proofRender();
    try { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); } catch (e) { dlg.setAttribute('open', ''); }
    ga('rain_print_proof', { style: ST.style });
  }
  function openOrder(id) {
    var box = $('rp-order');
    box.hidden = false;
    $('ro-choice').value = id;
    syncAddress();
    $('ro-design').value = designUrl(ST);
    $('ro-out').innerHTML = '';
    syncSummary();
    try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    try { $('ro-name').focus({ preventScroll: true }); } catch (e) {}
  }
  /* "It's a gift" on an ordinary order (2026-10-12), a tick box over the price
     cards. Any finished year and any product; this year's January gift has its
     own box (#rp-gift), so the tick box is not offered then.
     A product WITH a Stripe Payment Link still goes straight to checkout; its
     Payment Link asks who it's for and the note, and Stripe takes the shipping
     address, so the page only says so (#rp-gift-checkout).
     A product WITHOUT a link opens the order request form, which then shows
     who it's for, a note printed on a card in the box (no prices go in), and
     where it goes. Same gift_ fields, plus gift:true (worker v5.12). */
  function januaryGift() { return giftMode() && canOrder(); }
  function giftTicked() { return !januaryGift() && $('ro-isgift').checked; }
  function plainGift() { return giftTicked() && !payLink($('ro-choice').value); }
  function syncGiftCheckout() {
    var el = $('rp-gift-checkout'), linked = PRODUCTS.filter(function (id) { return payLink(id); });
    var t = '';
    if (giftTicked() && linked.length) {
      t = 'You\u2019ll add their name and your note at checkout. Use their address for shipping if it goes straight to them.';
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
    $('ro-gift-line').textContent = print ? 'Sig prints the note on a card in the box. No prices go in the box.'
      : 'Sig sends the note with the file. No prices go with it.';
    $('ro-deliver-wrap').hidden = !(jan || plain);
    var theirs = (jan || plain) && $('ro-deliver').value === 'recipient';
    $('ro-address-label').textContent = jan ? 'Ship to (name, street, town, state, ZIP; theirs is fine)'
      : plain && theirs ? 'Ship to them (their name, street, town, state, ZIP)' : 'Ship to (name, street, town, state, ZIP)';
    // a gift file sent straight to the person it is for needs their email
    var mail = theirs && !print;
    $('ro-gift-email-wrap').hidden = !mail;
    $('ro-gift-email').required = mail;
  }
  var EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;
  function orderSubject(x) {
    return 'Rain print order' + (x.gift_january ? ' (' + ST.year + ' gift, January)' : x.gift ? ' (gift)' : '') + ': ' + CHOICE[x.choice] + ' for ' + x.name;
  }
  function orderText(x) {
    return orderSubject(x) + '\n\nName: ' + x.name + '\nEmail: ' + x.email +
      (x.gift_january || x.gift ? (x.gift_january ? '\nGift: yes, make it after January 1 once the December numbers are in' : '\nGift: yes, a note card in the box, no prices') +
        (x.gift_to ? '\nGift for: ' + x.gift_to : '') + '\nDeliver to: ' + (x.gift_deliver === 'recipient' ? 'the person it is for' : 'the buyer') +
        (x.gift_email ? '\nTheir email: ' + x.gift_email : '') + (x.gift_message ? '\nCard message: ' + x.gift_message : '') : '') +
      (x.address ? '\nShip to:\n' + x.address : '') + (x.notes ? '\nNotes: ' + x.notes : '') +
      '\nDesign code: ' + x.design_code + '\nDesign: ' + x.design_url + '\n';
  }
  var sending = false;
  function submitOrder(e) {
    e.preventDefault();
    if (sending) return;
    var out = $('ro-out');
    if (!canOrder()) { out.innerHTML = '<p class="rp-msg rp-bad">Draw your print first.</p>'; return; }
    var x = {
      name: cleanText($('ro-name').value, 80), email: $('ro-email').value.trim(), choice: $('ro-choice').value,
      address: $('ro-address').value.trim().slice(0, 600), notes: $('ro-notes').value.trim().slice(0, 2000),
      design_url: designUrl(ST), design_code: orderCode(), page: '/rain-print'
    };
    // the worker keeps known fields only, so the proof tick rides in the notes
    x.notes = ((PROOF_OK === encodeCode(ST) ? 'Proof checked on the page: yes.' : 'Proof checked on the page: no.') + (x.notes ? '\n' + x.notes : '')).slice(0, 2000);
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
    var bad = !x.name ? ['ro-name', 'Add your name.'] : !EMAIL_RE.test(x.email) ? ['ro-email', 'Add an email address Sig can reply to.']
      : (x.choice !== 'digital' && x.address.length < 10) ? ['ro-address', 'Add the shipping address for the print.']
      : (plain && !x.gift_to) ? ['ro-gift-to', 'Say who the gift is for, or untick It\u2019s a gift.']
      : ((gift || plain) && x.choice === 'digital' && x.gift_deliver === 'recipient' && !EMAIL_RE.test(x.gift_email)) ? ['ro-gift-email', 'Add their email for the file, or choose Me under Deliver to.'] : null;
    if (bad) { out.innerHTML = '<p class="rp-msg rp-bad">' + esc(bad[1]) + '</p>'; try { $(bad[0]).focus(); } catch (err) {} return; }
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
        out.innerHTML = r.ok ? root.AgRpGift.doneHtml(GIFT, r) : '<p class="rp-msg rp-bad">' + esc(r.error || 'That didn\u2019t go through. Try again, or write to ' + ORDER_TO + '.') + '</p>';
        if (r.ok) { $('ro-form').reset(); syncGiftUse(); $('rp-gift-use-wrap').hidden = true; }
        try { out.firstChild.focus(); } catch (err) {}
      }).then(function () { sending = false; btn.disabled = false; btn.textContent = was; });
      return;
    }
    var send = root.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
    send('rain-print-order', data, fs).then(function () {
      ga('rain_print_order', { result: 'ok', choice: x.choice, gift: gift ? 1 : plain ? 2 : 0 });
      out.innerHTML = gift
        ? '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> Sig will email you within a day with a payment link.</p>' +
          '<p>Your ' + ST.year + ' print is made once the station\u2019s December numbers are in. He sends the proof then, and it is delivered in January. He writes to ' + esc(x.email) +
          '; nothing is charged until you pay that link. Your design code is <code>' + esc(x.design_code) + '</code>.</p>' +
          '<p>Once you\u2019ve paid, Sig emails you a gift card to print, with a code that opens their print.</p></div>'
        : '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> Sig will email ' + esc(x.email) + ' within 1 business day with a proof of this design and a payment link.</p>' +
          '<p>Nothing is charged until you pay that link, and nothing prints until you OK the proof. ' + (x.choice === 'digital' ? 'The file comes by email within 1 business day after you pay.' : 'It ships within ' + ((PRICES && PRICES.ship_business_days) || 7) + ' business days after you OK the proof.') +
          ' If the email doesn\u2019t come, check spam, or write to ' + ORDER_TO + (shortRef() ? ' and give your order reference, <b>' + esc(shortRef()) + '</b>.' : '.') + '</p></div>';
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

  // ---------- for businesses: a quote request for a set of prints ----------
  /* Its own form (#rb-form, kind rain-print-business, worker v5.12). It needs
     no drawn design: the business sends a list of towns and years and Sig
     quotes it. The cutoff line, the table and the per-print readout come only
     from data/rain-print.json (bizCutoffNote, bizRows, bizQuote above).
     Prices are delivered, shipping included (Sig, 2026-10-13). */
  var BIZ_PRODUCT = { print: 'print12x18', framed: 'framed12x18', digital: 'digital' };
  var BIZ_WORD = { print: ['print', 'prints'], framed: ['framed', 'framed'], digital: ['digital file', 'digital files'],
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
    var offs = [];
    if (off.print12x18) offs.push(money(off.print12x18) + ' off each print');
    if (off.framed12x18) offs.push(money(off.framed12x18) + ' off each framed');
    $('rp-biz-ship').textContent = rows.length
      ? 'Every price is per print, delivered: shipping to US addresses is included, one to each customer or all to one. ' +
        (offs.length && firstOff ? 'All to one address' + (firstOff.from > rows[0].from ? ', from ' + firstOff.from + ' prints' : '') + ': ' + offs.join(', ') + '. ' : '') + 'A digital file is ' + money(j.digital) + ' each, emailed. ' +
        (max < BIZ_MAX ? 'Over ' + max + ' prints, ask Sig and he quotes it.' : '')
      : 'Sig quotes business orders by email. Shipping to US addresses is included.';
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
    var c = function (x) { return '$' + x.toFixed(2).replace(/\B(?=(\d{3})+\.)/g, ','); };
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
    if (!one || !each) { out.textContent = 'For ' + qty + ', Sig quotes it himself. Send the request and he writes back.'; return; }
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
      (x.note_all ? '\nNote for every print: ' + x.note_all : '') + '\nTowns and years:\n' + x.towns + (x.notes ? '\nNotes: ' + x.notes : '') + '\n';
  }
  var bizSending = false;
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
      : !EMAIL_RE.test(x.email) ? ['rb-email', 'Add an email address Sig can reply to.']
      : qn >= 1 && qn < BIZ_MIN ? ['rb-qty', 'Business orders start at ' + BIZ_MIN + '. For fewer, order the regular way above.']
      : !(qn >= BIZ_MIN && qn <= BIZ_MAX) ? ['rb-qty', 'Put how many prints, from ' + BIZ_MIN + ' to ' + BIZ_MAX + '. For more than ' + BIZ_MAX + ', put ' + BIZ_MAX + ' and say how many in the notes.']
      : !x.towns ? ['rb-towns', 'Add the towns and years, or the one town for all of them.'] : null;
    if (bad) { out.innerHTML = '<p class="rp-msg rp-bad">' + esc(bad[1]) + '</p>'; try { $(bad[0]).focus(); } catch (err) {} return; }
    x.quantity = String(qn);
    // the shared note card goes only to prints shipped one to each customer
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
      out.innerHTML = '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Sent.</b> Sig will write to ' + esc(x.email) + ' with a quote, then proofs.</p>' +
        '<p>Nothing is printed or charged until you OK them.</p></div>';
      $('rb-form').reset(); syncBizShip(); syncBizTier();
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
  /* -> Promise<canvas>. kind 'preview' (watermarked, 2000 px wide, no bleed),
     'digital' (the $19 file: 300 dpi at the trim, no bleed, no serial) or a print
     size key (the printer's file: bleed, and the serial when the link has one). */
  function drawCanvas(kind) {
    var P = PRINT[kind === 'preview' || kind === 'digital' ? ST.size : kind];
    var o = {}, pxW, pxH;
    if (kind === 'preview') {
      pxW = 2000; pxH = Math.round(2000 * P.h / P.w); o.watermark = true;
    } else if (kind === 'digital') {
      pxW = P.w * DPI; pxH = P.h * DPI;
    } else {
      o.serial = SERIAL;
      pxW = Math.round((P.w + 2 * BLEED_IN) * DPI); pxH = Math.round((P.h + 2 * BLEED_IN) * DPI);
      o.bleed = ART_UNITS_IN * BLEED_IN;
    }
    o.px = [pxW, pxH];
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
            cx.drawImage(img, 0, 0, pxW, pxH);
            URL.revokeObjectURL(url);
            resolve(c);
          } catch (e) { reject(e); } });
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
        img.src = url;
      });
    });
  }
  function toBlob(c, type, q) { return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('too large for this browser')); }, type, q); }); }
  /* A one-page PDF around a JPEG: MediaBox = bleed size, TrimBox inset 0.125 in. No library. */
  function pdfFromJpeg(jpeg, pxW, pxH, P) {
    var enc = new TextEncoder(), parts = [], offs = [], len = 0;
    var put = function (x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    var wPt = (P.w + 2 * BLEED_IN) * 72, hPt = (P.h + 2 * BLEED_IN) * 72, bl = BLEED_IN * 72;
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
  function exportFile(kind, fmt, btn) {
    if (!DATA || BLOCKED) return;
    var was = btn.textContent, out = $('rp-dl-note');
    btn.disabled = true; btn.textContent = 'Making the file…';
    var name = slug() + (kind === 'preview' ? '-preview' : kind === 'digital' ? '-digital-300dpi' : '-' + kind + '-300dpi' + (SERIAL ? '-no-' + SERIAL.replace(/\D/g, '') : ''));
    var job;
    if (fmt === 'svg') {
      job = fontCss().then(function (css) { return new Blob([buildSvg({ fontCss: css })], { type: 'image/svg+xml' }); }).then(function (b) { saveBlob(b, slug() + '.svg'); return 'SVG saved.'; });
    } else {
      job = drawCanvas(kind).then(function (c) {
        if (fmt === 'pdf') {
          return toBlob(c, 'image/jpeg', 0.95).then(function (j) { return j.arrayBuffer(); }).then(function (buf) {
            saveBlob(pdfFromJpeg(new Uint8Array(buf), c.width, c.height, PRINT[kind]), name + '.pdf');
            return 'PDF saved: ' + PRINT[kind].label + ' plus 0.125 in bleed on each side, ' + c.width + ' x ' + c.height + ' px.';
          });
        }
        return toBlob(c, 'image/png').then(function (b) {
          saveBlob(b, name + '.png');
          return kind === 'preview' ? 'Preview saved (' + c.width + ' x ' + c.height + ' px, watermarked).'
            : kind === 'digital' ? 'Digital file saved: ' + c.width + ' x ' + c.height + ' px, 18 x 12 in at 300 dpi, no serial.'
            : 'Print file saved' + (SERIAL ? ' with ' + SERIAL : ', no serial (add &serial=N to the link)') + ': ' + PRINT[kind].label + ' plus 0.125 in bleed on each side, ' + c.width + ' x ' + c.height + ' px at 300 dpi.';
        });
      });
    }
    job.then(function (msg) { out.textContent = msg; ga('rain_print_download', { kind: kind, fmt: fmt }); },
      function () { out.textContent = 'This browser couldn\u2019t make the file. Try it on a computer.'; })
      .then(function () { btn.disabled = false; btn.textContent = was; });
  }

  // ---------- wire up ----------
  buildYears();
  writeInputs(ST);
  doc.querySelectorAll('.rp-cy').forEach(function (el) { el.textContent = String(CURRENT_YEAR); });
  // "Giving it for Christmas?" reads right from October through December only
  $('rp-gift-hint').hidden = parseInt(TODAY.slice(5, 7), 10) < 10;
  if (MAKER) $('rp-maker').hidden = false;
  form.addEventListener('submit', run);
  $('rp-station').addEventListener('change', function () {
    ST.station = $('rp-station').value;
    if (SAMPLE) run(null, Object.assign({}, ST)); else run();
  });
  $('rp-sample-use').addEventListener('click', useSample);
  doc.querySelectorAll('.rp-view .chip').forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
  $('rp-year').addEventListener('input', function () { syncMarkerBounds(); syncDates(); });
  ['rp-name', 'rp-ded', 'rp-m1l', 'rp-m2l', 'rp-m3l'].forEach(function (id) { $(id).addEventListener('input', function () { cleanField(id); restyle(); }); });
  ['rp-m1d', 'rp-m2d', 'rp-m3d'].forEach(function (id) { $(id).addEventListener('input', function () { syncDates(); restyle(); }); });
  // label ideas as buttons: a tap fills the first empty label (its date box next)
  LABEL_PRESETS.forEach(function (w) {
    var b = doc.createElement('button'); b.type = 'button'; b.textContent = w;
    b.addEventListener('click', function () {
      for (var i = 1; i <= 3; i++) if (!$('rp-m' + i + 'l').value) { $('rp-m' + i + 'l').value = w; cleanField('rp-m' + i + 'l'); restyle(); try { $('rp-m' + i + 'd').focus(); } catch (e) {} return; }
    });
    $('rp-presets').appendChild(b);
  });
  syncCounts();
  radios('rp-style').forEach(function (r) { r.addEventListener('change', restyle); });
  // the normals are NOAA's 30-year normal: showing them makes that the comparison, and another comparison turns them off
  $('rp-normals').addEventListener('change', function () { if ($('rp-normals').checked) $('rp-cmp').value = 'normal'; restyle(); });
  $('rp-cmp').addEventListener('change', function () { if ($('rp-cmp').value !== 'normal') $('rp-normals').checked = false; restyle(); });
  $('rp-records').addEventListener('change', restyle);
  doc.querySelectorAll('.rp-buy-btn').forEach(function (b) { b.addEventListener('click', function () { buy(b.getAttribute('data-choice')); }); });
  $('ro-choice').addEventListener('change', function () { syncAddress(); syncSummary(); });
  $('rp-proof-open').addEventListener('click', openProof);
  $('rp-proof-close').addEventListener('click', function () { $('rp-proof').close(); });
  $('rp-proof-order').addEventListener('click', function () {
    $('rp-proof').close();
    if (!canOrder()) { buy('framed12x18'); return; }   // the sample: off to the town box
    try { $('rp-buy').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  });
  $('rp-proof-ok').addEventListener('change', function () { PROOF_OK = $('rp-proof-ok').checked ? encodeCode(ST) : ''; syncSummary(); });
  doc.querySelectorAll('[data-pstyle]').forEach(function (b) { b.addEventListener('click', function () {
    radios('rp-style').forEach(function (r) { r.checked = r.value === b.getAttribute('data-pstyle'); }); restyle(); proofRender(); }); });
  doc.querySelectorAll('[data-pview]').forEach(function (b) { b.addEventListener('click', function () { PROOF_VIEW = b.getAttribute('data-pview'); proofRender(); }); });
  doc.querySelectorAll('[data-pzoom]').forEach(function (b) { b.addEventListener('click', function () { PROOF_ZOOM = b.getAttribute('data-pzoom'); proofRender(); }); });
  // drag to move around the actual-size proof
  (function () {
    var st = $('rp-proof-stage'), down = null;
    st.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') return; down = { x: e.clientX, y: e.clientY, l: st.scrollLeft, t: st.scrollTop }; });
    root.addEventListener('pointermove', function (e) { if (!down) return; st.scrollLeft = down.l - (e.clientX - down.x); st.scrollTop = down.t - (e.clientY - down.y); });
    root.addEventListener('pointerup', function () { down = null; });
  })();
  $('ro-deliver').addEventListener('change', syncAddress);
  $('ro-isgift').addEventListener('change', syncAddress);
  $('ro-form').addEventListener('submit', submitOrder);
  $('rb-form').addEventListener('submit', submitBiz);
  $('rb-qty').addEventListener('input', syncBizTier);
  radios('rb-product').concat(radios('rb-ship')).forEach(function (r) { r.addEventListener('change', syncBizTier); });
  radios('rb-ship').forEach(function (r) { r.addEventListener('change', syncBizShip); });
  $('rp-dl').addEventListener('click', function () { exportFile('preview', 'png', $('rp-dl')); });
  doc.querySelectorAll('#rp-maker button').forEach(function (b) {
    b.addEventListener('click', function () { exportFile(b.getAttribute('data-size'), b.getAttribute('data-fmt'), b); });
  });
  $('rp-copy').addEventListener('click', function () {
    var u = shortUrl(artDesign()), b = $('rp-copy');
    var ok = function () { b.textContent = 'Link copied'; setTimeout(function () { b.textContent = 'Copy link'; }, 2000); };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(u).then(ok, function () { root.prompt('Copy this link', u); });
    else root.prompt('Copy this link', u);
  });
  $('rp-gift-use').addEventListener('click', function () { useGift(); });
  $('rp-retry').addEventListener('click', function () { $('rp-retry-row').hidden = true; run(); });
  doc.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t && t.id === 'rp-chg') { ev.preventDefault(); var sl = $('rp-station'); try { sl.scrollIntoView({ behavior: 'smooth', block: 'center' }); sl.focus({ preventScroll: true }); } catch (e) {} }
  });
  // A share link that can't be drawn says why, over the sample (2026-10-13: it fell back quietly).
  var LINK_WHY = linkProblem(root.location.search);
  if (LINK_WHY) { $('rp-link-note').textContent = LINK_WHY; $('rp-link-note').hidden = false; }
  showBuy(false);
  // the art measures its labels with these fonts: draw again once they are in
  fontsReady().then(function () { if (DATA && !BLOCKED) render(); });
  loadPrices();
  if (ST.place && ST.year) run();
  else runSample();

  /* THE GIFT CARD (2026-10-13). A card is issued by Sig after payment (worker
     v5.16) and printed from /rp-gift. Its link, /rain-print?gift=RP-XXXX-XXXX-XXXX,
     is redeemed here through components/rp-gift.js (loaded with defer, so this
     runs once the page is parsed): a banner says whose gift it is, a locked
     card draws its design and holds those inputs still, the three buy buttons
     become one "Use my gift", and the order posts /rp-gift/redeem instead of a
     plain order. ?gift=1 is the old January design flag, not a card. */
  var GIFT = null;
  var LOCK_IDS = { place: ['rp-place', 'rp-go'], year: ['rp-year'], station: ['rp-station'], style: ['rp-style'], cmp: ['rp-cmp'], name: ['rp-name'],
    dedication: ['rp-ded'], markers: ['rp-m1d', 'rp-m1l', 'rp-m2d', 'rp-m2l', 'rp-m3d', 'rp-m3l'], normals: ['rp-normals'], records: ['rp-records'] };
  function lockInput(field) {
    (LOCK_IDS[field] || []).forEach(function (id) {
      if (id === 'rp-style') { radios('rp-style').forEach(function (r) { r.disabled = true; }); doc.querySelectorAll('[data-pstyle]').forEach(function (b) { b.disabled = true; }); return; }
      var el = $(id); if (el) { el.disabled = true; el.setAttribute('data-gift-lock', '1'); }
    });
  }
  function syncGiftUse() {
    var on = !!(GIFT && GIFT.usable);
    $('rp-gift-use-wrap').hidden = !on;
    doc.querySelectorAll('.rp-prods, #rp-isgift-wrap').forEach(function (el) { if (on) el.hidden = true; });
    if (!on) return;
    $('rp-gift-use-note').textContent = 'Your card covers ' + root.AgRpGift.product(GIFT.product) + '.' + (canOrder() ? '' : ' Draw the print above first.');
    $('rp-gift-use').disabled = !canOrder();
  }
  function useGift() {
    if (!GIFT || !GIFT.usable) return;
    if (!canOrder()) { buy(GIFT.product); return; }
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
      var keepName = g.lock.edit === 'name' && $('rp-name').value ? $('rp-name').value : null;
      ST = normalize(g.lock.design);
      if (keepName) ST.name = cleanText(printable(keepName), LIMITS.name);
      if (SAMPLE) { SAMPLE = null; sampleLine(false); }
      writeInputs(ST);
      run();
    }
    (g.locked || []).forEach(lockInput);
    syncGiftUse();
    ga('rain_print_gift_open', { kind: g.kind || '' });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', giftStart); else giftStart();
})(typeof window !== 'undefined' ? window : this);
