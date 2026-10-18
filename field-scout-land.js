/* Field Scout: the land card (Oct 17, 2026). Parcel lines and owner for the field
   picked, every recorded transfer of that parcel we have, sold-land comps with a
   list and filters, and the flood, wetland and terrain layers. All free, no sign-up.

   Loaded by field-scout-read.js when a field is picked, and by /field-report.
   The top half (FSLand) is plain functions with no page in them, so the tests in
   test/field-scout-land.test.mjs run them in node. The bottom half draws the card.

   Where things come from, read at the moment a reader picks a field:
   - Parcel and owner: free public government parcel services only. The list is
     data/land/parcel-services.json; scripts/probe_land_services.py checks each one
     (fields, a test query, and that a browser page is allowed to read it). Wisconsin's
     statewide parcel map is built in, the rest switch on only once the probe passes.
     Owner names show for the parcels under the picked field and nowhere else.
   - Transfers and comps: data/land/<st>/<county fips>.json, built from the state's
     own public transfer return data by scripts/fetch_land_sales.py.
   - Layers: FEMA flood map, USFWS wetlands, USGS 3DEP elevation. */
(function (G) {
  'use strict';
  var FSLand = {};

  // ── small helpers ──────────────────────────────────────────────────
  function num(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  FSLand.num = num;
  function clean(s) { s = s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); return s; }
  FSLand.clean = clean;

  // $/acre: price over acres, whole dollars. Nothing when either is missing or zero.
  FSLand.perAcre = function (price, acres) {
    price = num(price); acres = num(acres);
    if (price == null || acres == null || price <= 0 || acres <= 0) return null;
    return Math.round(price / acres);
  };

  FSLand.milesBetween = function (lat1, lng1, lat2, lng2) {
    var R = 3958.8, p = Math.PI / 180;
    var a = Math.sin((lat2 - lat1) * p / 2), b = Math.sin((lng2 - lng1) * p / 2);
    var h = a * a + Math.cos(lat1 * p) * Math.cos(lat2 * p) * b * b;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  // Acres of a lat/lng ring (spherical excess formula, same as Leaflet.GeometryUtil).
  FSLand.ringAcres = function (pts) {
    if (!pts || pts.length < 3) return 0;
    var R = 6378137, p = Math.PI / 180, area = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      area += (b.lng - a.lng) * p * (2 + Math.sin(a.lat * p) + Math.sin(b.lat * p));
    }
    return Math.abs(area * R * R / 2) / 4046.8564224;
  };

  // "45.12345,-91.12345~45.1,-91.2~..." (the Field Scout share link) to points.
  FSLand.decodeField = function (s) {
    try { s = decodeURIComponent(String(s || '')); } catch (e) { return null; }
    var pts = s.split('~').map(function (t) { var a = t.split(','); return { lat: +a[0], lng: +a[1] }; })
      .filter(function (q) { return isFinite(q.lat) && isFinite(q.lng) && Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180 && !(q.lat === 0 && q.lng === 0); });
    return pts.length >= 3 && pts.length <= 80 ? pts : null;
  };
  FSLand.centroid = function (pts) {
    var la = 0, ln = 0; pts.forEach(function (q) { la += q.lat; ln += q.lng; });
    return { lat: la / pts.length, lng: ln / pts.length };
  };

  // ── parcel numbers ─────────────────────────────────────────────────
  // Counties write the same parcel many ways: "022-1234-56-000", "0221234 56000",
  // "22-1234-56". Three keys, strictest first:
  //   strip: letters and digits only, upper case          (022123456000)
  //   seg:   each run of digits without its leading zeros (22-1234-56-0)
  //   core:  seg with trailing all-zero runs dropped       (22-1234-56)
  FSLand.parcelKeys = function (id) {
    var s = clean(id).toUpperCase();
    if (!s) return null;
    var strip = s.replace(/[^A-Z0-9]/g, '');
    if (!strip || /^0+$/.test(strip)) return null;
    var runs = s.match(/[A-Z]+|[0-9]+/g) || [];
    var segs = runs.map(function (r) { return /^[0-9]+$/.test(r) ? String(parseInt(r, 10)) : r; });
    var seg = segs.join('-');
    var core = segs.slice();
    while (core.length > 1 && core[core.length - 1] === '0') core.pop();
    return { strip: strip, seg: seg, core: core.join('-') };
  };

  // Section, township, range out of a legal description ("SE NE SEC 12 T33N R10W").
  FSLand.parseSTR = function (legal) {
    var s = clean(legal).toUpperCase();
    if (!s) return null;
    var sec = /\bS(?:EC(?:TION)?)?\.?\s*(\d{1,2})\b/.exec(s);
    var t = /\bT(?:WP|OWNSHIP)?\.?\s*(\d{1,3})\s*N\b/.exec(s) || /\bT\s*(\d{1,3})N/.exec(s);
    var r = /\bR(?:GE|ANGE)?\.?\s*(\d{1,3})\s*([EW])\b/.exec(s) || /\bR\s*(\d{1,3})([EW])/.exec(s);
    if (!sec || !t || !r) return null;
    var q = s.match(/\b(NE|NW|SE|SW)\b/g) || [];
    return { sec: +sec[1], twp: +t[1], rng: +r[1], dir: r[2], q: q.slice(0, 2).join(' ') };
  };
  FSLand.sameSTR = function (a, b) {
    return !!(a && b && a.sec === b.sec && a.twp === b.twp && a.rng === b.rng && a.dir === b.dir);
  };
  function normMuni(m) { return clean(m).toUpperCase().replace(/^(TOWN|VILLAGE|CITY|T|V|C)\s+OF\s+/, '').replace(/[^A-Z]/g, ''); }

  // Transfers of one parcel. rows are objects (see rowObj). A match is:
  //   exact:   the parcel numbers agree letter for letter (punctuation aside)
  //   format:  they agree once leading and trailing zero runs are set aside
  //   uncertain: no number match, but the same municipality and the same
  //            section, township, range and quarters in the legal description.
  //            That is how a parcel looks after a split; we say so on the page.
  FSLand.matchTransfers = function (parcel, rows) {
    var out = [];
    var keys = (parcel.ids || []).map(FSLand.parcelKeys).filter(Boolean);
    var str = FSLand.parseSTR(parcel.legal);
    var muni = normMuni(parcel.muni);
    (rows || []).forEach(function (r) {
      var k = FSLand.parcelKeys(r.pid), how = null;
      if (k && keys.length) {
        if (keys.some(function (x) { return x.strip === k.strip; })) how = 'exact';
        else if (keys.some(function (x) { return x.seg === k.seg || x.core === k.core; })) how = 'format';
      }
      if (!how && str && muni && normMuni(r.muni) === muni) {
        var rs = FSLand.parseSTR(r.legal);
        if (FSLand.sameSTR(str, rs) && rs.q && str.q && rs.q === str.q) how = 'uncertain';
      }
      if (how) out.push({ r: r, how: how });
    });
    return FSLand.sortHistory(out);
  };
  // Newest first; a same-day pair keeps the higher document number on top.
  FSLand.sortHistory = function (list) {
    return list.slice().sort(function (a, b) {
      var x = (a.r || a).date || '', y = (b.r || b).date || '';
      if (x !== y) return x < y ? 1 : -1;
      var dx = String((a.r || a).doc || ''), dy = String((b.r || b).doc || '');
      return dx < dy ? 1 : dx > dy ? -1 : 0;
    });
  };

  // ── transfer files (data/land/<st>/<fips>.json) ────────────────────
  // { cols:[...], rows:[[...]], munis:{code:[name,lat,lng]} }; rowObj turns one row into an object.
  // Acres on a return that covers several parcels are uncertain unless the file was built
  // with the checked rule (acres_rule 2 in scripts/fetch_land_sales.py: each added parcel read
  // once, in acres). Files built before it summed repeated added-parcel rows, so a 160-acre
  // quarter could read 894.9 acres. Uncertain acres show as unknown and give no $/acre.
  FSLand.ACRES_RULE = 2;
  FSLand.rowObjs = function (file) {
    if (!file || !file.cols || !file.rows) return [];
    var ix = {}; file.cols.forEach(function (c, i) { ix[c] = i; });
    var munis = file.munis || {}, checked = (+file.acres_rule || 0) >= FSLand.ACRES_RULE;
    return file.rows.map(function (a) {
      var o = {}; file.cols.forEach(function (c, i) { o[c] = a[i]; });
      var m = munis[o.muni];
      if (m) { o.muniName = m[0]; o.lat = m[1]; o.lng = m[2]; }
      else o.muniName = o.muni;
      if ((+o.np || 1) > 1 && (!checked || !(num(o.acres) > 0))) { o.acres = null; o.acUnsure = true; }
      o.ppa = FSLand.perAcre(o.price, o.acres);
      o.county = file.county; o.st = file.state; o.fips = file.fips; o.src = file.source_short;
      return o;
    });
  };

  // Wisconsin property classes (the assessment classes printed on the tax bill).
  var CLASS = { '1': 'Residential', '2': 'Commercial', '3': 'Manufacturing', '4': 'Agricultural', '5': 'Undeveloped',
    '5M': 'Agricultural forest', '6': 'Productive forest', '7': 'Other (farm buildings)', 'X': 'Exempt' };
  FSLand.classLabel = function (c) {
    return String(c || '').split(/[\s,;/]+/).filter(Boolean).map(function (x) { return CLASS[x.toUpperCase()] || x; }).join(', ');
  };
  FSLand.FARM_CLASSES = ['4', '5', '5M', '6', '7'];
  FSLand.hasBuildings = function (c) { return /(^|[\s,;/])(1|2|3|7)($|[\s,;/])/.test(String(c || '')); };

  // A sale counts as a comp only when it reads like a market sale: a price, acres,
  // and a deed type that normally carries one. Quit claims, gifts and the transfers
  // the return marks exempt from the fee are left out by default.
  // Related-party sales (Illinois MyDec Line 10b; the builder adds ", related parties" to the deed
  // type) are not arm's length, and court, partition, mineral and beneficial-interest transfers
  // are not a field changing hands at a market price. A multi-parcel sale whose acres are
  // uncertain stays listed, with no $/acre.
  FSLand.NON_MARKET = /QUIT|GIFT|CORRECT|TERMINAT|TRANSFER ON DEATH|\bTOD\b|SHERIFF|FORECLOS|EASEMENT|LEASE|RELATED PART|PARTITION|MINERAL|JUDICIAL|JUDGE|COMMISSIONER|COURT OFFICER|BENEFICIAL INTEREST/;
  FSLand.marketSale = function (r) {
    if (!r || !(num(r.price) > 0) || !(num(r.acres) > 0 || r.acUnsure)) return false;
    if (r.exempt) return false;
    if (FSLand.NON_MARKET.test(String(r.conv || '').toUpperCase())) return false;
    return true;
  };

  // Filters for the comps list. f = { minAc, maxAc, minPpa, maxPpa, since (YYYY-MM-DD),
  // cls: ['4',...] (any match), maxMi, all (include non-market deeds), sort, dir }
  FSLand.filterComps = function (rows, f, origin) {
    f = f || {};
    var out = (rows || []).filter(function (r) {
      if (!(num(r.price) > 0) || !(num(r.acres) > 0 || r.acUnsure)) return false;   // a list of prices needs a price
      if (!f.all && !FSLand.marketSale(r)) return false;
      var ac = num(r.acres), ppa = r.ppa != null ? r.ppa : FSLand.perAcre(r.price, r.acres);
      if (f.minAc != null && !(ac >= f.minAc)) return false;
      if (f.maxAc != null && !(ac <= f.maxAc)) return false;
      if (f.minPpa != null && !(ppa >= f.minPpa)) return false;
      if (f.maxPpa != null && !(ppa <= f.maxPpa)) return false;
      if (f.since && !(String(r.date || '') >= f.since)) return false;
      if (f.cls && f.cls.length) {
        var have = String(r.cls || '').toUpperCase().split(/[\s,;/]+/);
        if (!f.cls.some(function (c) { return have.indexOf(String(c).toUpperCase()) >= 0; })) return false;
      }
      return true;
    }).map(function (r) {
      var o = {}; for (var k in r) o[k] = r[k];
      o.ppa = o.ppa != null ? o.ppa : FSLand.perAcre(o.price, o.acres);
      o.mi = origin && r.lat != null && r.lng != null ? FSLand.milesBetween(origin.lat, origin.lng, r.lat, r.lng) : null;
      return o;
    }).filter(function (o) { return f.maxMi == null || (o.mi != null && o.mi <= f.maxMi); });
    var key = f.sort || 'date', dir = f.dir === 'asc' ? 1 : -1;
    out.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;           // missing values sink, whichever way
      if (y == null) return -1;
      return x < y ? -dir : x > y ? dir : 0;
    });
    return out;
  };
  // Middle of the $/acre list (the median), with the count. Nothing under 3 sales.
  FSLand.medianPpa = function (rows) {
    var v = (rows || []).map(function (r) { return r.ppa; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
    if (v.length < 3) return null;
    var m = v.length >> 1;
    return { ppa: v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2), n: v.length };
  };

  // ── parcel services ────────────────────────────────────────────────
  // A service entry names its fields; parseParcel reads one feature's attributes with it.
  FSLand.parseParcel = function (attrs, svc) {
    var F = (svc && svc.fields) || {}, a = attrs || {};
    function pick(k) {
      var names = F[k]; if (!names) return null;
      if (!Array.isArray(names)) names = [names];
      var vals = names.map(function (n) { return clean(a[n]); }).filter(function (v) { return v && !/^(null|none|n\/a|0)$/i.test(v); });
      return vals.length ? vals : null;
    }
    function one(k) { var v = pick(k); return v ? v[0] : null; }
    function n1(k) {   // numbers keep a real 0 (bare land has no improvements)
      var names = F[k]; if (!names) return null;
      if (!Array.isArray(names)) names = [names];
      for (var i = 0; i < names.length; i++) { var x = num(a[names[i]]); if (x != null) return x; }
      return null;
    }
    var ids = (pick('pid') || []).concat(pick('pid2') || []);
    var owner = pick('owner');
    // an owner split into name parts (first, middle, last) reads as one name on one line
    if (F.owner_parts) { var parts = pick('owner_parts'); owner = parts ? [parts.join(' ')] : null; }
    var p = {
      ids: ids, id: ids[0] || null,
      owner: owner ? owner.filter(function (v, i, s) { return s.indexOf(v) === i; }) : null,
      mail: pick('mail') ? pick('mail').join(', ') : null,
      site: pick('site') ? pick('site').join(', ') : null,
      gisAc: n1('gis_acres'), deedAc: n1('deed_acres'), assdAc: n1('assd_acres'),
      land: n1('land'), imp: n1('imp'), total: n1('total'), fmv: n1('fmv'),
      cls: pick('cls') ? pick('cls').join(', ') : null,
      county: one('county'), muni: one('muni'), legal: pick('legal') ? pick('legal').join(' ') : null,
      year: one('year'), date: one('date')
    };
    if (p.land === 0 && p.imp === 0 && !p.total) { p.land = null; p.imp = null; p.total = null; }   // blank rolls write zeros
    if (p.total == null && p.land != null && p.imp != null) p.total = p.land + p.imp;
    return p;
  };
  FSLand.ringsToLatLngs = function (geom) {
    if (!geom || !geom.rings) return [];
    return geom.rings.map(function (r) { return r.map(function (xy) { return { lat: xy[1], lng: xy[0] }; }); });
  };
  // The services that cover a spot: county entries first (more detail), then statewide.
  FSLand.servicesFor = function (reg, st, fips) {
    reg = reg || {}; var out = [];
    var co = reg.counties && fips && reg.counties[fips];
    if (co) (Array.isArray(co) ? co : [co]).forEach(function (s) { if (s.verified) out.push(s); });
    var sw = reg.statewide && st && reg.statewide[st];
    // a statewide layer that leaves some counties out (Minnesota) lists the ones it covers
    if (sw) sw.forEach(function (s) { if ((s.verified || s.builtin) && (!s.covers || (fips && s.covers.indexOf(fips) >= 0))) out.push(s); });
    return out;
  };

  // What a reader sees where no free parcel service is on: names where to look, never a guess.
  FSLand.parcelEmpty = function (stName, county, links) {
    var where = county ? county + ' County' : 'the county';
    var t = 'Parcel and owner lines for ' + (stName || 'this state') + ' come from county offices.';
    var b = 'We show owners only from free public government parcel services, and we have not found one that covers ' +
      where + ' yet. The ' + where + ' assessor, treasurer or GIS office keeps the parcel map and owner of record; most post it free.';
    return { title: t, body: b, links: links || [] };
  };

  FSLand.fmtMoney = function (n) { n = num(n); return n == null ? '' : '$' + Math.round(n).toLocaleString('en-US'); };
  FSLand.fmtDate = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return String(iso || '');
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  };

  // ── transfer history and comps list (plain strings, so node tests run them) ──
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var fm = FSLand.fmtMoney, fd = FSLand.fmtDate;

  // The span a transfer file really covers. Filed (recorded) dates when the file has them; a
  // filing can carry a far older deed date (a 2018 Illinois filing dated 1999), so the deed
  // dates are not the span. Files without filed dates: the state's own start year.
  FSLand.FILED_SINCE = { IL: 'Illinois MyDec declarations filed from 2014' };
  FSLand.coverageText = function (cov, st) {
    if (!cov || !cov.to) return '';
    if (cov.filed_from) return (String(st || '').toUpperCase() === 'IL' ? 'Declarations' : 'Returns') + ' filed ' + fd(cov.filed_from) + ' to ' + fd(cov.filed_to) +
      (cov.older_deeds ? '; ' + cov.older_deeds.toLocaleString() + (cov.older_deeds === 1 ? ' carries a deed date' : ' carry deed dates') + ' before ' + String(cov.filed_from).slice(0, 4) : '');
    var since = FSLand.FILED_SINCE[String(st || '').toUpperCase()];
    if (since) return since + ' to ' + fd(cov.to) + (cov.from && String(cov.from).slice(0, 4) < '2014' ? '; some filings carry older deed dates' : '');
    return 'Transfer returns from ' + fd(cov.from) + ' to ' + fd(cov.to);
  };
  // The coverage object a transfer file gives historyHTML.
  FSLand.covOf = function (f) {
    var c = (f && f.coverage) || {}, o = { names: !!(f && f.names), county: f && f.county, src: f && f.source_short, links: f && f.links, st: f && f.state };
    for (var k in c) o[k] = c[k];
    return o;
  };
  FSLand.historyHTML = function (matches, cov, opts) {
    opts = opts || {};
    var names = cov && cov.names;
    var span = cov && cov.from ? 'In our copy: ' + FSLand.coverageText(cov, cov.st) + '.' : '';
    var older = 'Older transfers, and deeds that never went through a transfer return, are at the ' + esc(cov && cov.county ? cov.county + ' County' : 'county') + ' Register of Deeds.';
    var links = (cov && cov.links || []).map(function (l) { return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.t) + '</a>'; }).join(' &middot; ');
    if (!matches.length) {
      return '<p class="fl-note">No recorded transfer of this parcel is in the ' + esc(cov && cov.src || 'state') + ' data we hold. ' + span + ' ' + older + '</p>' + (links ? '<p class="fl-note fl-links">' + links + '</p>' : '');
    }
    var anyUnsure = matches.some(function (m) { return m.how === 'uncertain'; });
    var li = matches.map(function (m) {
      var r = m.r, ppa = FSLand.perAcre(r.price, r.acres);
      var bits = [];
      bits.push(r.price > 0 ? fm(r.price) : 'no price on the return');
      if (r.acres > 0) bits.push((+r.acres).toFixed(1) + ' ac');
      else if (r.acUnsure) bits.push((+r.np || 2) + ' parcels, acres uncertain');
      if (ppa != null) bits.push(fm(ppa) + '/ac');
      var who = names ? ('<div>' + esc(r.grantor || 'seller not given') + ' &rarr; ' + esc(r.grantee || 'buyer not given') + '</div>') : '';
      var meta = [r.conv ? esc(r.conv) : null, r.cls ? esc(FSLand.classLabel(r.cls)) : null, r.exempt ? 'exempt from the transfer fee' : null,
        m.how === 'format' ? 'parcel number matched with county formatting set aside' : null,
        m.how === 'uncertain' ? '<span class="fl-warn">match uncertain: same section, quarter and town, parcel number differs (often a split)</span>' : null,
        r.doc ? 'doc ' + esc(r.doc) : null].filter(Boolean).join(' &middot; ');
      return '<li><span class="d">' + fd(r.date) + '</span> &middot; ' + bits.join(' &middot; ') + who + '<div class="m">' + meta + '</div></li>';
    }).join('');
    return '<ul class="fl-hist">' + li + '</ul>' +
      '<p class="fl-note">' + span + ' ' + older + (names ? '' : ' Seller and buyer names are not in the free data; the official record has them.') +
      (anyUnsure ? ' Rows marked uncertain may belong to a neighboring piece of the same parcel.' : '') +
      ' A sale price covers everything that sold, buildings included, unless the class says bare land.</p>' + (links ? '<p class="fl-note fl-links">' + links + '</p>' : '');
  };
  // opts.detail: each sale's date is a button that opens the detail panel (data-sale = index in list).
  // opts.src: a source column (the printable report).
  FSLand.compsTable = function (list, max, opts) {
    max = max || 40; opts = opts || {};
    if (!list.length) return '<p class="fl-note">No sales match these filters.</p>';
    function th(k, t, n) { return '<th class="' + (n ? 'n' : '') + '">' + (opts.detail ? '<button type="button" data-sort="' + k + '">' + t + '</button>' : t) + '</th>'; }
    return '<div class="fl-tblw"><table class="fl-tbl' + (opts.detail ? ' fl-tap' : '') + '"><thead><tr>' + th('date', 'Date') + th('ppa', '$/ac', 1) + th('acres', 'Acres', 1) + th('price', 'Price', 1) + th('mi', 'Miles', 1) + '<th>Town, class</th>' + (opts.src ? '<th>Source</th>' : '') + '</tr></thead><tbody>' +
      list.slice(0, max).map(function (r, i) {
        var town = esc(r.muniName || '') + (r.cls ? ', ' + esc(FSLand.classLabel(r.cls)) : '');
        var date = opts.detail ? '<button type="button" class="fl-sale" data-sale="' + i + '" aria-haspopup="dialog" aria-label="' + esc('Everything on the sale of ' + fd(r.date) + (r.price > 0 ? ', ' + fm(r.price) : '') + (r.acres > 0 ? ', ' + (+r.acres).toFixed(1) + ' acres' : '') + (r.muniName ? ', ' + r.muniName : '')) + '">' + fd(r.date) + '</button>' : fd(r.date);
        /* data-l: the column name a phone shows over each value when the rows stack into cards (2026-10-17) */
        return '<tr' + (opts.detail ? ' data-row="' + i + '"' : '') + '><td data-l="Date">' + date + '</td><td class="n" data-l="$/ac">' + (r.ppa != null ? fm(r.ppa) : '') + '</td><td class="n" data-l="Acres">' + (r.acres > 0 ? (+r.acres).toFixed(1) : r.acUnsure ? '<span title="' + (+r.np || 2) + ' parcels on one return; acres uncertain">?</span>' : '') + '</td><td class="n" data-l="Price">' + fm(r.price) + '</td><td class="n" data-l="Miles">' + (r.mi != null ? (r.mi < 0.5 ? '&lt;1' : r.mi.toFixed(0)) : '') + '</td><td class="t" data-l="Town, class">' + town + (FSLand.hasBuildings(r.cls) ? ' <span class="fl-warn">with buildings</span>' : '') + '</td>' +
          (opts.src ? '<td class="t" data-l="Source">' + esc(r.src || '') + (r.doc ? ' ' + esc(r.doc) : '') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>' + (list.length > max && opts.detail ? '<p class="fl-note">Showing ' + max + ' of ' + list.length + '. Narrow the filters to see the rest.</p>' : '');
  };

  // ── one sale in full: the detail panel (Oct 18, 2026) ───────────────
  // Every column a transfer file carries reaches the panel; a blank one says "not in the record".
  // Fields the state's form has but our file does not keep say "not in our copy".
  FSLand.LEGAL_MAX = 140;   // scripts/fetch_land_sales.py LEGAL_MAX: our copy keeps this much of the legal description
  var NOTIN = '<span class="fl-miss">not in the record</span>';
  var NOTKEPT = '<span class="fl-miss">not in our copy of the record</span>';
  FSLand.NOT_IN_RECORD = 'not in the record';
  FSLand.NAME_MAX = 80;     // fetch_land_sales.py keeps the first 80 characters of a name
  // Section, township and range for display, read from numerals or from words with numerals beside
  // them ("Section Twenty-nine (29), Township fifteen (15) North, Range Six (6) E").
  FSLand.strOf = function (legal) {
    var s = clean(legal).toUpperCase();
    if (!s) return null;
    s = s.replace(/\b(?:[A-Z]+-)?[A-Z]+\s*\((\d{1,3})\)/g, '$1');
    var sec = /\bSEC(?:TION|S)?\.?\s*(\d{1,2})\b/.exec(s);
    var t = /\bT(?:OWNSHIP|WP)?\.?\s*(\d{1,3})\s*(N|S)(?:ORTH|OUTH)?\b/.exec(s);
    var r = /\bR(?:ANGE|GE)?\.?\s*(\d{1,3})\s*(E|W)(?:AST|EST)?\b/.exec(s);
    if (!sec || !t || !r) return null;
    var pm = /\b(SECOND|THIRD|FOURTH|FIFTH|2ND|3RD|4TH|5TH)\s+(?:PRINCIPAL\s+MERIDIAN|P\.?\s?M\b)/.exec(s);
    return 'Section ' + (+sec[1]) + ', T' + (+t[1]) + t[2] + ', R' + (+r[1]) + r[2] + (pm ? ', ' + pm[1].charAt(0) + pm[1].slice(1).toLowerCase() + ' Principal Meridian' : '');
  };
  FSLand.relatedParty = function (r) { return /RELATED PART/i.test(String(r && r.conv || '')); };
  // Why a sale is left out of the market-sales list (empty when it is in).
  FSLand.notMarketWhy = function (r) {
    var why = [];
    if (!(num(r.price) > 0)) why.push('no price on the return');
    if (!(num(r.acres) > 0) && !r.acUnsure) why.push('no acres on the return');
    if (r.exempt) why.push('exempt from the transfer fee');
    var c = String(r.conv || '').toUpperCase();
    if (/RELATED PART/.test(c)) why.push('buyer and seller related');
    else if (FSLand.NON_MARKET.test(c)) why.push('the deed type does not usually carry a market price');
    return why;
  };
  // ArcGIS where clause that finds one parcel number in a parcel service, as written and with
  // punctuation set aside. Quotes are doubled; nothing but the parcel number goes in.
  FSLand.parcelWhere = function (svc, pid) {
    var F = (svc && svc.fields) || {}, names = [].concat(F.pid || [], F.pid2 || []);
    var v = clean(pid); if (!names.length || !FSLand.parcelKeys(v)) return null;
    var vals = [v, FSLand.parcelKeys(v).strip].filter(function (x, i, a) { return a.indexOf(x) === i; })
      .map(function (x) { return "'" + x.replace(/'/g, "''") + "'"; }).join(',');
    return names.map(function (n) { return n + ' IN (' + vals + ')'; }).join(' OR ');
  };
  // Of the features a parcel service sent back, the one that is this parcel: same parcel number
  // (exact, or with county formatting set aside) and, when the service names counties, the same county.
  FSLand.pickParcel = function (ps, pid, county) {
    var k = FSLand.parcelKeys(pid); if (!k) return null;
    var want = clean(county).toUpperCase().replace(/[^A-Z]/g, '');
    var hit = (ps || []).filter(function (p) {
      var same = (p.ids || []).some(function (id) { var x = FSLand.parcelKeys(id); return x && (x.strip === k.strip || x.seg === k.seg); });
      var co = clean(p.county).toUpperCase().replace(/[^A-Z]/g, '').replace(/COUNTY$/, '');
      return same && (!want || !co || co === want);
    });
    return hit.length === 1 ? hit[0] : null;   // two parcels with one number: we will not pick
  };

  // The panel's body. r: a row from rowObjs (with mi when the list figured it); file: its county
  // file; others: matchTransfers of the same parcel, this sale left out. Plain strings for node.
  FSLand.saleDetailHTML = function (r, file, others) {
    file = file || {}; others = others || [];
    var st = String(r.st || file.state || '').toUpperCase(), IL = st === 'IL', WI = st === 'WI';
    var cols = file.cols || [];
    var has = function (c) { return cols.indexOf(c) >= 0; };
    var v = function (x) { return x == null || x === '' ? null : x; };
    var rows = [];
    function row(k, html, note) { rows.push('<tr><th scope="row">' + esc(k) + '</th><td>' + html + (note ? '<div class="fl-note">' + note + '</div>' : '') + '</td></tr>'); }
    function group(t) { rows.push('<tr class="fl-sd-g"><th colspan="2" scope="colgroup">' + esc(t) + '</th></tr>'); }
    var price = num(r.price), ac = num(r.acres), np = +r.np || 1;

    group('The sale');
    row(IL ? 'Deed date (instrument date)' : 'Deed date (date of conveyance)', v(r.date) ? fd(r.date) : NOTIN);
    row('Recorded (filed)', has('rec') ? (v(r.rec) ? fd(r.rec) : NOTIN) : NOTKEPT, has('rec') ? null : 'The state file has the recording date; our copy keeps only the deed date for ' + esc(st || 'this state') + '.');
    row('Price', price > 0 ? fm(price) : price === 0 ? '$0 on the ' + (IL ? 'declaration' : 'return') : NOTIN,
      IL ? 'Net consideration (Line 13 of Form PTAX-203), or full consideration (Line 11) when Line 13 is blank. Covers everything that sold.' : 'Sale price on the transfer return. Covers everything that sold, buildings included.');
    row('Acres', ac > 0 ? (+ac).toFixed(2).replace(/\.?0+$/, '') : r.acUnsure ? '<span class="fl-warn">uncertain</span>' : NOTIN,
      r.acUnsure ? np + ' parcels on one ' + (IL ? 'declaration' : 'return') + ' and the acres do not add up for sure, so we print no total.' : (np > 1 ? 'All ' + np + ' parcels together.' : null));
    if (has('ac1') && (np > 1 || v(r.ac1) != null)) row(IL ? 'Lot size or acreage as written (Line 1)' : 'Acres on the first parcel line', v(r.ac1) != null ? esc(r.ac1) : NOTIN, np > 1 ? 'As the filer wrote it. Often the whole sale, sometimes one parcel.' : null);
    if (has('tac') && v(r.tac) != null) row('Acres added over repeated rows', v(r.tac) != null ? esc(r.tac) : NOTIN);
    row('$/acre', r.ppa != null ? fm(r.ppa) : '<span class="fl-miss">not figured</span>', r.ppa != null ? 'Price over acres.' : (price > 0 ? 'Acres are not known for sure.' : 'There is no price to divide.'));
    row('Deed or conveyance type', v(r.conv) ? esc(r.conv) : NOTIN);
    row('Property class', v(r.cls) ? esc(FSLand.classLabel(r.cls)) + ' <span class="fl-note">(' + (IL ? 'the declaration marks the current use as farm, Line 8' : 'Wisconsin class ' + esc(r.cls)) + ')</span>' : NOTIN);
    row('Buyer and seller related', FSLand.relatedParty(r) ? '<span class="fl-warn">Yes</span>, the ' + (IL ? 'declaration (Line 10b)' : 'return') + ' says so' : 'Not marked related on the ' + (IL ? 'declaration' : 'return'));
    row(IL ? 'State transfer tax' : 'Transfer fee', r.exempt ? 'Exemption claimed' + (IL ? ' (Line 16)' : ' (an exemption number is on the return)') : (has('exempt') ? 'No exemption claimed' : NOTIN));
    var why = FSLand.notMarketWhy(r);
    row('In the market-sales list', why.length ? 'No: ' + esc(why.join('; ')) : 'Yes', 'Arm’s length is not stated on the form; we leave out related parties, gifts, quit claims, court and partition deeds and fee-exempt transfers.');

    group('Who');
    if (file.names && has('grantor')) {
      var cut = function (x) { return String(x || '').length >= FSLand.NAME_MAX ? 'May be cut short: our copy keeps the first ' + FSLand.NAME_MAX + ' characters.' : null; };
      row('Seller (grantor)', v(r.grantor) ? esc(r.grantor) : NOTIN, cut(r.grantor));
      row('Buyer (grantee)', v(r.grantee) ? esc(r.grantee) : NOTIN, cut(r.grantee));
    } else {
      row('Seller and buyer', NOTKEPT, 'The free state data does not carry names here; the deed at the county has them.');
    }

    group('Where');
    row(IL ? 'Township' : 'Town, village or city', v(r.muniName) ? esc(r.muniName) : NOTIN);
    row('County', v(r.county || file.county) ? esc((r.county || file.county) + ' County, ' + st) : NOTIN);
    row(np > 1 ? 'Parcel number (first on the ' + (IL ? 'declaration' : 'return') + ')' : 'Parcel number', v(r.pid) ? esc(r.pid) : NOTIN,
      np > 1 ? 'This sale covers ' + np + ' parcels. Our copy keeps the first parcel number only; the other ' + (np - 1) + ' are on the ' + (IL ? 'declaration' : 'return') + ' and the deed.' : null);
    row('Parcels in this sale', String(np));
    var leg = clean(r.legal);
    row('Legal description', leg ? esc(leg) : NOTIN, leg.length >= FSLand.LEGAL_MAX - 2 ? 'May be cut short: our copy keeps the first ' + FSLand.LEGAL_MAX + ' characters.' : null);
    var str = FSLand.strOf(leg);
    row('Section, township, range', str ? esc(str) : (leg ? '<span class="fl-miss">not readable from the legal description</span>' : NOTIN));
    row('Street address', NOTKEPT);
    row('Distance from your field', r.mi != null ? 'About ' + (r.mi < 0.5 ? 'less than 1 mile' : Math.round(r.mi) + (Math.round(r.mi) === 1 ? ' mile' : ' miles')) + ' to the center of ' + esc(r.muniName || 'the town') : '<span class="fl-miss">not figured</span>',
      'Measured to the center of the town where the sale was filed. The parcel’s own spot is not in our copy.');

    var other = others.length ? '<ul class="fl-hist">' + others.map(function (m, i) {
      var o = m.r || m;
      return '<li><button type="button" class="fl-sale" data-other="' + i + '"><span class="d">' + fd(o.date) + '</span></button> &middot; ' + (o.price > 0 ? fm(o.price) : 'no price') +
        (o.acres > 0 ? ' &middot; ' + (+o.acres).toFixed(1) + ' ac' : '') + (o.ppa != null ? ' &middot; ' + fm(o.ppa) + '/ac' : '') +
        '<div class="m">' + [o.conv ? esc(o.conv) : null, file.names && (o.grantor || o.grantee) ? esc(o.grantor || 'seller not given') + ' &rarr; ' + esc(o.grantee || 'buyer not given') : null,
          m.how === 'format' ? 'parcel number matched with county formatting set aside' : null].filter(Boolean).join(' &middot; ') + '</div></li>';
    }).join('') + '</ul>' : '<p class="fl-note">No other transfer of parcel ' + esc(r.pid || '(no number)') + ' is in our copy. ' + esc(FSLand.coverageText(file.coverage, st)) + '.</p>';

    var links = (file.links || []).map(function (l) { return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.t) + '</a>'; }).join(' &middot; ');
    var office = IL ? 'Clerk and Recorder' : 'Register of Deeds';
    var src = '<p class="fl-note">' + esc(file.source || 'State transfer data') + (v(r.doc) ? ', document ' + esc(r.doc) : '') + '. ' +
      (file.fetched_utc ? 'Our copy was read ' + fd(String(file.fetched_utc).slice(0, 10)) + '. ' : '') +
      'The deed itself is at the ' + esc((r.county || file.county || 'county') + ' County ' + office) + '.</p>' + (links ? '<p class="fl-note fl-links">' + links + '</p>' : '');
    var notIn = '<p class="fl-note"><b>Not in our copy:</b> the street address, ' + (np > 1 ? 'the other parcel numbers, ' : '') +
      'the parcel outline, financing, any personal property in the price (machinery, grain, buildings’ contents), and why the land sold. The full ' +
      (IL ? 'declaration' : 'transfer return') + ' or the deed has more. This is a public record of one sale, not an appraisal.</p>';

    return '<table class="fl-kv fl-sd-kv">' + rows.join('') + '</table>' +
      '<h3>On the map</h3><div class="fl-sd-map"><button type="button" class="fl-btn" data-sd="map">Show on map</button><div id="fl-sd-where" class="fl-note">Looking for this parcel on the parcel map.</div></div>' +
      '<h3>Current owner (parcel map today)</h3><div id="fl-sd-owner"><div class="fs-loading"><span class="fs-spin"></span>reading</div></div>' +
      '<h3>Other recorded transfers of this parcel</h3>' + other +
      '<h3>Source</h3>' + src + notIn;
  };
  // Field Scout's comps filters, carried to the printable report: "mi:25,ac:10,s:2023-10-18,c:5M.6,a:1".
  var FKEYS = { maxMi: 'mi', minAc: 'ac', maxAc: 'ax', minPpa: 'p1', maxPpa: 'p2' };
  FSLand.encodeFilter = function (f) {
    f = f || {}; var out = [];
    Object.keys(FKEYS).forEach(function (k) { if (f[k] != null && isFinite(f[k])) out.push(FKEYS[k] + ':' + (+f[k])); });
    if (f.since) out.push('s:' + f.since);
    if (f.cls && f.cls.length) out.push('c:' + f.cls.join('.'));
    if (f.all) out.push('a:1');
    return out.join(',');
  };
  FSLand.decodeFilter = function (s) {
    var f = {}, back = {}; Object.keys(FKEYS).forEach(function (k) { back[FKEYS[k]] = k; });
    var ok = false;
    String(s || '').split(',').forEach(function (p) {
      var i = p.indexOf(':'); if (i < 1) return;
      var k = p.slice(0, i), val = p.slice(i + 1);
      if (back[k] && /^\d+(\.\d+)?$/.test(val)) { f[back[k]] = +val; ok = true; }
      else if (k === 's' && /^\d{4}-\d{2}-\d{2}$/.test(val)) { f.since = val; ok = true; }
      else if (k === 'c' && /^[0-9A-Z.]{1,20}$/i.test(val)) { f.cls = val.split('.').filter(Boolean); ok = true; }
      else if (k === 'a' && val === '1') { f.all = true; ok = true; }
    });
    return ok ? f : null;
  };
  // The filters in words, for the report's comps line.
  FSLand.filterText = function (f) {
    f = f || {}; var b = [];
    b.push(f.all ? 'every deed type' : 'market sales');
    if (f.minAc != null || f.maxAc != null) b.push(f.minAc != null && f.maxAc != null ? f.minAc + ' to ' + f.maxAc + ' acres' : f.minAc != null ? f.minAc + ' acres or more' : 'up to ' + f.maxAc + ' acres');
    if (f.minPpa != null) b.push('at least ' + fm(f.minPpa) + '/ac');
    if (f.maxPpa != null) b.push('at most ' + fm(f.maxPpa) + '/ac');
    if (f.maxMi != null) b.push('within ' + f.maxMi + ' miles');
    if (f.since) b.push('since ' + fd(f.since));
    if (f.cls && f.cls.length) b.push('class ' + FSLand.classLabel(f.cls.join(' ')).toLowerCase());
    return b.join(', ');
  };

  // The comparable sales report (/comp-report, one shared page) for a field outline or for one
  // sale's parcel, carrying the Sold land nearby filters. sub: { pts } or { pid, fips, lat, lng, town }.
  FSLand.compReportURL = function (sub, f) {
    sub = sub || {}; f = f || {}; var b = [];
    if (sub.pts && sub.pts.length >= 3) b.push('f=' + encodeURIComponent(sub.pts.map(function (q) { return (+q.lat).toFixed(5) + ',' + (+q.lng).toFixed(5); }).join('~')));
    else if (sub.lat != null && sub.lng != null) { b.push('lat=' + (+sub.lat).toFixed(5), 'lon=' + (+sub.lng).toFixed(5)); if (sub.town) b.push('at=town'); }
    if (sub.pid) b.push('pid=' + encodeURIComponent(sub.pid));
    if (sub.fips) b.push('fips=' + encodeURIComponent(sub.fips));
    if (f.maxMi != null && isFinite(f.maxMi)) b.push('r=' + (+f.maxMi));
    b.push('from=' + (f.since || 'any'));
    b.push('amin=' + (f.minAc != null && isFinite(f.minAc) ? +f.minAc : 'any'));
    if (f.maxAc != null && isFinite(f.maxAc)) b.push('amax=' + (+f.maxAc));
    if (f.cls && f.cls.length) b.push('cls=' + f.cls.join(','));
    if (f.all) b.push('all=1');
    return '/comp-report?' + b.join('&');
  };

  if (typeof module === 'object' && module.exports) { module.exports = FSLand; return; }
  G.FSLand = FSLand;

  // ════════════════════════════════════════════════════════════════════
  // The card. Everything below runs in the browser only.
  // ════════════════════════════════════════════════════════════════════
  var REG_URL = '/data/land/parcel-services.json';

  function getJSON(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms || 20000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error(String(r.status)); return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }
  var _reg = null;
  FSLand.registry = function () {
    if (!_reg) _reg = getJSON(REG_URL, 15000).catch(function () { _reg = null; return {}; });
    return _reg;
  };

  // ArcGIS REST query: features under the field outline (or a point).
  FSLand.queryParcels = function (svc, pts) {
    var ring = pts.map(function (q) { return [+q.lng.toFixed(6), +q.lat.toFixed(6)]; });
    ring.push(ring[0]);
    var geom = JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } });
    var url = svc.url.replace(/\/$/, '') + '/query?f=json&where=1%3D1&outFields=*&returnGeometry=true&outSR=4326' +
      '&geometryType=esriGeometryPolygon&spatialRel=esriSpatialRelIntersects&inSR=4326&resultRecordCount=25&geometry=' + encodeURIComponent(geom);
    if (url.length > 7000) {
      var la = pts.map(function (q) { return q.lat; }), ln = pts.map(function (q) { return q.lng; });
      var env = [Math.min.apply(null, ln), Math.min.apply(null, la), Math.max.apply(null, ln), Math.max.apply(null, la)].join(',');
      url = svc.url.replace(/\/$/, '') + '/query?f=json&where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&resultRecordCount=25&geometry=' + env;
    }
    return getJSON(url, 20000).then(function (d) {
      if (!d || d.error || !d.features) throw new Error(d && d.error ? (d.error.message || 'service error') : 'no answer');
      return d.features.map(function (f) {
        var p = FSLand.parseParcel(f.attributes, svc);
        p.rings = FSLand.ringsToLatLngs(f.geometry);
        p.svc = svc;
        return p;
      }).filter(function (p) { return p.id || p.owner; });
    });
  };
  // When the service itself was last changed (ArcGIS layer metadata).
  FSLand.serviceDate = function (svc) {
    return getJSON(svc.url.replace(/\/$/, '') + '?f=json', 12000).then(function (m) {
      var t = m && ((m.editingInfo && (m.editingInfo.dataLastEditDate || m.editingInfo.lastEditDate)) || null);
      return t ? new Date(t).toISOString().slice(0, 10) : null;
    }, function () { return null; });
  };

  // Field area inside each parcel: share of the field's sample points that fall in it.
  function inRing(q, r) {
    var ins = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var a = r[i], b = r[j];
      if (((a.lat > q.lat) !== (b.lat > q.lat)) && (q.lng < (b.lng - a.lng) * (q.lat - a.lat) / (b.lat - a.lat) + a.lng)) ins = !ins;
    }
    return ins;
  }
  function inParcel(q, p) { var n = 0; (p.rings || []).forEach(function (r) { if (inRing(q, r)) n++; }); return n % 2 === 1; }
  function fieldGrid(pts, n) {
    var la = pts.map(function (q) { return q.lat; }), ln = pts.map(function (q) { return q.lng; });
    var a0 = Math.min.apply(null, la), a1 = Math.max.apply(null, la), b0 = Math.min.apply(null, ln), b1 = Math.max.apply(null, ln), out = [];
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var q = { lat: a0 + (a1 - a0) * (i + .5) / n, lng: b0 + (b1 - b0) * (j + .5) / n };
      if (inRing(q, pts)) out.push(q);
    }
    return out.length ? out : [FSLand.centroid(pts)];
  }
  FSLand.shareInParcels = function (pts, parcels) {
    var g = fieldGrid(pts, 24);
    parcels.forEach(function (p) { var k = 0; g.forEach(function (q) { if (inParcel(q, p)) k++; }); p.share = k / g.length; });
    return parcels.filter(function (p) { return p.share > 0.004; }).sort(function (a, b) { return b.share - a.share; });
  };

  // ── transfers + comps data ─────────────────────────────────────────
  var _idx = {}, _co = {};
  function landIndex(st) {
    st = String(st || '').toLowerCase();
    if (!_idx[st]) _idx[st] = getJSON('/data/land/' + st + '/index.json', 15000).catch(function () { _idx[st] = null; return null; });
    return _idx[st];
  }
  function countyFile(st, fips) {
    var k = st + fips;
    if (!_co[k]) _co[k] = getJSON('/data/land/' + st.toLowerCase() + '/' + fips + '.json', 20000).catch(function () { _co[k] = null; return null; });
    return _co[k];
  }
  // The field's own county plus any county whose center is within reach.
  FSLand.loadSales = function (st, c, homeFips, reachMi) {
    return landIndex(st).then(function (ix) {
      if (!ix || !ix.counties) return { ix: ix, rows: [], files: [] };
      var pick = ix.counties.filter(function (k) {
        return k.fips === homeFips || (k.lat != null && FSLand.milesBetween(c.lat, c.lng, k.lat, k.lng) <= (reachMi || 40));
      }).sort(function (a, b) { return (a.fips === homeFips ? -1 : 0) - (b.fips === homeFips ? -1 : 0) || FSLand.milesBetween(c.lat, c.lng, a.lat, a.lng) - FSLand.milesBetween(c.lat, c.lng, b.lat, b.lng); }).slice(0, 7);
      return Promise.all(pick.map(function (k) { return countyFile(st, k.fips); })).then(function (fs) {
        var rows = [], files = [];
        fs.forEach(function (f) { if (f) { files.push(f); rows = rows.concat(FSLand.rowObjs(f)); } });
        return { ix: ix, rows: rows, files: files };
      });
    });
  };

  // ── styles (kept here so the first screen does not carry them) ─────
  var CSS = '.fl-p{border:1px solid var(--border);border-radius:8px;background:var(--surface2);padding:.7rem .8rem;margin:.55rem 0}' +
    '.fl-p h4{margin:0 0 .35rem;font-size:.95rem;color:var(--text);font-family:var(--font-display,inherit)}' +
    '.fl-kv{width:100%;border-collapse:collapse;font-size:.86rem}.fl-kv th{text-align:left;font-weight:500;color:var(--text-muted);padding:.2rem .6rem .2rem 0;vertical-align:top;width:40%}.fl-kv td{color:var(--text);padding:.2rem 0;overflow-wrap:anywhere}' +
    '.fl-note{font-size:.8rem;color:var(--text-dim);line-height:1.5;margin:.4rem 0}.fl-warn{color:var(--gold)}' +
    '.fl-tabs{display:flex;gap:.35rem;flex-wrap:wrap;margin:.3rem 0 .5rem}.fl-tabs button,.fl-btn{font:inherit;font-size:.82rem;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:999px;padding:.32rem .7rem;cursor:pointer;min-height:34px}' +
    '.fl-tabs button[aria-pressed="true"],.fl-btn[aria-pressed="true"]{border-color:var(--gold);color:var(--gold)}' +
    '.fl-hist{list-style:none;margin:.3rem 0;padding:0}.fl-hist li{border-top:1px solid var(--border);padding:.45rem 0;font-size:.85rem;color:var(--text)}.fl-hist li:first-child{border-top:0}' +
    '.fl-hist .d{font-family:var(--font-mono);font-weight:700}.fl-hist .m{color:var(--text-dim);font-size:.8rem}' +
    '.fl-filt{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem .6rem;margin:.4rem 0;font-size:.8rem;color:var(--text-muted)}.fl-filt label{display:flex;flex-direction:column;gap:.15rem;min-width:0}' +
    '.fl-filt input,.fl-filt select{font:inherit;font-size:.85rem;padding:.3rem .4rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);min-width:0;width:100%;box-sizing:border-box}' +
    '.fl-tblw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:.3rem 0}.fl-tbl{width:100%;border-collapse:collapse;font-size:.82rem;min-width:420px}' +
    '.fl-tbl th{text-align:left;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);padding:.3rem .4rem;white-space:nowrap}' +
    '.fl-tbl th button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}.fl-tbl td{padding:.3rem .4rem;border-bottom:1px solid var(--border);color:var(--text);white-space:nowrap}' +
    '.fl-tbl td.n,.fl-tbl th.n{text-align:right;font-family:var(--font-mono)}' +
    /* phones: the sort buttons become a row of chips and each sale a small card, no sideways scroll */
    '@media(max-width:560px){.fl-tblw{overflow:visible}.fl-tbl{min-width:0;display:block}.fl-tbl thead,.fl-tbl tbody{display:block}' +
    '.fl-tbl thead tr{display:flex;flex-wrap:wrap;gap:.3rem;margin:0 0 .4rem}.fl-tbl th{border:1px solid var(--border);border-radius:999px;padding:.25rem .6rem;font-size:.75rem}.fl-tbl thead th:last-child{display:none}' +
    '.fl-tbl th button{min-height:28px}.fl-tbl thead tr::before{content:"Sort by";align-self:center;font-size:.75rem;color:var(--text-muted);margin-right:.1rem}' +
    '.fl-tbl tbody tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.1rem .5rem;border:1px solid var(--border);border-radius:8px;padding:.4rem .55rem;margin:0 0 .4rem}' +
    '.fl-tbl td,.fl-tbl td.n{border:0;padding:.05rem 0;text-align:left;white-space:normal}.fl-tbl td.t{grid-column:1/-1;font-family:inherit;color:var(--text-dim);font-size:.78rem}' +
    '.fl-tbl td[data-l]:not(.t)::before{content:attr(data-l);display:block;font-family:var(--font-mono);font-size:.64rem;color:var(--text-muted)}}' +
    '.fl-big{font-family:var(--font-mono);font-size:1.3rem;font-weight:700;color:var(--text)}' +
    '.fl-links a{color:var(--gold)}.fl-empty{border:1px dashed var(--border);border-radius:8px;padding:.7rem .8rem;margin:.5rem 0}.fl-empty b{color:var(--text)}' +
    '.fl-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.35rem 0}.fl-chip{font-size:.8rem;border:1px solid var(--border);border-radius:999px;padding:.15rem .55rem;color:var(--text)}' +
    /* a sale row opens its detail panel: the date is the button, the whole row is the tap target (Oct 18) */
    '.fl-sale{font:inherit;color:var(--gold);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;min-height:28px;text-align:left}' +
    '.fl-sale:focus-visible,.fl-sd-x:focus-visible,.fl-sd .fl-btn:focus-visible{outline:2px solid var(--gold);outline-offset:2px}' +
    '.fl-tap tbody tr{cursor:pointer}.fl-tap tbody tr:hover td{background:var(--surface)}' +
    '.fl-miss{color:var(--text-muted);font-style:italic}' +
    '.fl-sd-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000}' +
    '.fl-sd{position:fixed;z-index:10001;left:0;right:0;bottom:0;max-height:88vh;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:var(--surface2,var(--surface));color:var(--text);border-top:2px solid var(--gold);border-radius:14px 14px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.45);padding:0 1rem calc(1.2rem + env(safe-area-inset-bottom))}' +
    '@media(min-width:900px){.fl-sd{top:0;left:auto;width:min(460px,94vw);max-height:none;border-top:0;border-left:2px solid var(--gold);border-radius:0;box-shadow:-8px 0 30px rgba(0,0,0,.45)}}' +
    '.fl-sd-h{position:sticky;top:0;background:inherit;display:flex;align-items:flex-start;gap:.6rem;padding:.8rem 0 .55rem;border-bottom:1px solid var(--border);margin-bottom:.4rem;z-index:1}' +
    '.fl-sd-h h2{flex:1;margin:0;font-size:1.05rem;line-height:1.3;color:var(--text)}.fl-sd-h .fl-note{margin:.15rem 0 0}' +
    '.fl-sd-x{font:inherit;font-size:1.3rem;line-height:1;min-width:44px;min-height:44px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);cursor:pointer}' +
    '.fl-sd h3{font-size:.9rem;margin:1rem 0 .3rem;color:var(--text)}.fl-sd-kv th{width:42%}.fl-sd-kv .fl-note{margin:.1rem 0 0;font-size:.74rem}' +
    '.fl-sd-g th{padding-top:.7rem!important;color:var(--gold)!important;font-family:var(--font-mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em}' +
    '.fl-sd-map{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .7rem}.fl-sd-map .fl-note{flex:1 1 220px;margin:0}' +
    '.fl-sd-grab{width:44px;height:4px;border-radius:2px;background:var(--border);margin:.45rem auto 0}@media(min-width:900px){.fl-sd-grab{display:none}}';
  function addCSS() {
    if (document.getElementById('fl-css')) return;
    var s = document.createElement('style'); s.id = 'fl-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  FSLand.addCSS = addCSS;

  // ── render pieces (shared with /field-report) ──────────────────────
  function kv(k, v) { return v == null || v === '' ? '' : '<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>'; }
  FSLand.parcelHTML = function (p, svcDate) {
    var ac = [];
    if (p.gisAc != null) ac.push(p.gisAc.toFixed(1) + ' GIS');
    if (p.deedAc != null) ac.push(p.deedAc.toFixed(1) + ' deeded');
    if (p.assdAc != null && p.assdAc !== p.deedAc) ac.push(p.assdAc.toFixed(1) + ' assessed');
    var vals = [];
    if (p.land != null) vals.push('land ' + fm(p.land));
    if (p.imp != null) vals.push('improvements ' + fm(p.imp));
    if (p.total != null && (p.land != null || p.imp != null)) vals.push('total ' + fm(p.total));
    var src = esc(p.svc.name) + (p.year ? ', tax roll ' + esc(p.year) : '') + (svcDate ? '; service last updated ' + fd(svcDate) : '');
    return '<table class="fl-kv">' +
      kv('Parcel ID', esc(p.id || 'not given')) +
      kv('Owner of record', p.owner ? p.owner.map(esc).join('<br>') : '<span class="fl-note">not in the public file</span>') +
      kv('Mailing address', p.mail ? esc(p.mail) : '') +
      kv('Site address', p.site ? esc(p.site) : '') +
      kv('Acres', ac.join(' &middot; ')) +
      kv('Assessed value', vals.join(' &middot; ')) +
      kv('Est. fair market value', p.fmv != null ? fm(p.fmv) + ' <span class="fl-note">(assessor)</span>' : '') +
      kv('Property class', p.cls ? esc(FSLand.classLabel(p.cls)) : '') +
      kv('Municipality', p.muni ? esc(p.muni) : '') +
      kv('Share of your field', p.share != null ? Math.round(p.share * 100) + '%' : '') +
      '</table><div class="fs-src">' + src + (p.svc.about ? ' &middot; <a href="' + esc(p.svc.about) + '" target="_blank" rel="noopener">about this data</a>' : '') + '</div>';
  };
  // ── layers (map images from the agencies; images need no permission to read) ──
  if (G.L && G.L.TileLayer) {
    FSLand.ArcLayer = G.L.TileLayer.extend({
      getTileUrl: function (co) {
        var sz = this.getTileSize(), m = this._map, crs = m.options.crs;
        var nw = crs.project(m.unproject(co.scaleBy(sz), co.z)), se = crs.project(m.unproject(co.scaleBy(sz).add(sz), co.z));
        var bbox = [nw.x, se.y, se.x, nw.y].join(',');
        return this._url + (this._url.indexOf('?') < 0 ? '?' : '&') + 'bbox=' + bbox + '&bboxSR=3857&imageSR=3857&size=' + sz.x + ',' + sz.y + '&format=png32&transparent=true&f=image';
      }
    });
  }
  FSLand.LAYERS = {
    flood: { t: 'Flood zones', src: 'FEMA National Flood Hazard Layer', url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?layers=show:28', about: 'https://www.fema.gov/flood-maps/national-flood-hazard-layer' },
    wet: { t: 'Wetlands', src: 'USFWS National Wetlands Inventory', url: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/export', about: 'https://www.fws.gov/program/national-wetlands-inventory' },
    relief: { t: 'Terrain', src: 'USGS 3DEP hillshade', url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?renderingRule=' + encodeURIComponent('{"rasterFunction":"Hillshade Gray"}'), about: 'https://www.usgs.gov/3d-elevation-program' }
  };

  // Which flood zones and wetland types touch the field (agency queries; read only).
  function arcQuery(base, pts, fields) {
    var ring = pts.map(function (q) { return [+q.lng.toFixed(6), +q.lat.toFixed(6)]; }); ring.push(ring[0]);
    var url = base + '/query?f=json&where=1%3D1&returnGeometry=false&outFields=' + fields + '&geometryType=esriGeometryPolygon&spatialRel=esriSpatialRelIntersects&inSR=4326&geometry=' + encodeURIComponent(JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } }));
    return getJSON(url, 20000).then(function (d) { if (!d || d.error || !d.features) throw new Error('no answer'); return d.features.map(function (f) { return f.attributes || {}; }); });
  }
  FSLand.floodAt = function (pts) {
    return arcQuery('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28', pts, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF').then(function (a) {
      var z = {}; a.forEach(function (x) { var k = clean(x.FLD_ZONE) + (x.ZONE_SUBTY && /FLOODWAY/i.test(x.ZONE_SUBTY) ? ' floodway' : ''); if (k) z[k] = (x.SFHA_TF === 'T'); });
      return Object.keys(z).map(function (k) { return { zone: k, sfha: z[k] }; });
    });
  };
  FSLand.wetAt = function (pts) {
    return arcQuery('https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0', pts, 'WETLAND_TYPE,ATTRIBUTE').then(function (a) {
      var z = {}; a.forEach(function (x) { var k = clean(x.WETLAND_TYPE); if (k) z[k] = (z[k] || 0) + 1; });
      return Object.keys(z).map(function (k) { return { type: k, n: z[k] }; });
    });
  };
  // Ground height at up to 9 points of the field (USGS point elevation service), in feet.
  FSLand.reliefAt = function (pts) {
    var g = fieldGrid(pts, 6), step = Math.max(1, Math.floor(g.length / 8)), pick = [FSLand.centroid(pts)];
    for (var i = 0; i < g.length && pick.length < 9; i += step) pick.push(g[i]);
    return Promise.all(pick.map(function (q) {
      return getJSON('https://epqs.nationalmap.gov/v1/json?x=' + q.lng.toFixed(6) + '&y=' + q.lat.toFixed(6) + '&wkid=4326&units=Feet&includeDate=false', 12000)
        .then(function (d) { var v = num(d && d.value); return v != null && v > -1000 ? v : null; }, function () { return null; });
    })).then(function (v) {
      v = v.filter(function (x) { return x != null; });
      if (v.length < 3) return null;
      var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
      return { lo: Math.round(lo), hi: Math.round(hi), n: v.length };
    });
  };
  FSLand.floodHTML = function (z) {
    if (!z) return '<p class="fl-note">The FEMA flood map did not answer. <a href="https://msc.fema.gov/portal/search" target="_blank" rel="noopener">FEMA Map Service Center</a> has the official map.</p>';
    if (!z.length) return '<p class="fl-note">No FEMA flood zone is mapped across this field. Many rural counties are only partly mapped; <a href="https://msc.fema.gov/portal/search" target="_blank" rel="noopener">check the official map</a>.</p>';
    return '<div class="fl-chips">' + z.map(function (x) { return '<span class="fl-chip">Zone ' + esc(x.zone) + (x.sfha ? ' (100-year floodplain)' : '') + '</span>'; }).join('') + '</div><p class="fl-note">Zones that touch the field, from the FEMA National Flood Hazard Layer. Zone X is outside the 100-year floodplain.</p>';
  };
  FSLand.wetHTML = function (w) {
    if (!w) return '<p class="fl-note">The national wetlands map did not answer.</p>';
    if (!w.length) return '<p class="fl-note">No mapped wetland touches this field in the National Wetlands Inventory.</p>';
    return '<div class="fl-chips">' + w.map(function (x) { return '<span class="fl-chip">' + esc(x.type) + '</span>'; }).join('') + '</div><p class="fl-note">Mapped from aerial photos by USFWS; not a wetland determination. For farm program rules, NRCS makes the call.</p>';
  };

  // ── the card on Field Scout ────────────────────────────────────────
  G.__fsLand = function (FSX) {
    addCSS();
    var S = { gen: null, layers: {}, parcels: [], sel: 0, f: { sort: 'date', dir: 'desc', maxMi: 25, since: null, minAc: 10 } };
    function body() { return document.getElementById('fs-land'); }
    function set(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
    function live() { return S.gen === FSX.fieldGen; }
    function waitCounty(ms) {
      return new Promise(function (ok) {
        var t0 = Date.now();
        (function tick() {
          var c = FSX.FIELD && FSX.FIELD.county;
          if (c && c.abbr) return ok(c);
          if (Date.now() - t0 > ms || !live()) return ok(null);
          setTimeout(tick, 300);
        })();
      });
    }
    function fipsOf(st, name) {
      if (!name) return Promise.resolve(null);
      return getJSON('/data/atlas/counties.geo.json', 30000).then(function (g) {
        var want = String(name).toUpperCase().replace(/[^A-Z]/g, '');
        var f = (g.features || []).filter(function (x) { return x.properties && x.properties.st === st && String(x.properties.name).toUpperCase().replace(/[^A-Z]/g, '') === want; })[0];
        return f ? String(f.id) : null;
      }, function () { return null; });
    }
    function drawParcels() {
      var map = FSX.map; if (!map || !G.L) return;
      if (S.lines) { map.removeLayer(S.lines); S.lines = null; }
      S.lines = G.L.layerGroup().addTo(map);
      var lines = S.lines, iv = setInterval(function () { if (!live() || S.lines !== lines) { clearInterval(iv); if (S.lines === lines && map.hasLayer(lines)) { map.removeLayer(lines); S.lines = null; } } }, 1000);
      S.parcels.forEach(function (p, i) {
        var poly = G.L.polygon(p.rings.map(function (r) { return r.map(function (q) { return [q.lat, q.lng]; }); }),
          { color: i === S.sel ? '#ffffff' : '#f2c14e', weight: i === S.sel ? 3 : 1.6, dashArray: i === S.sel ? null : '4 4', fill: true, fillOpacity: 0.02, interactive: true });
        poly.on('click', function (e) { if (e && e.originalEvent) G.L.DomEvent.stopPropagation(e); S.sel = i; renderParcels(); drawParcels(); });
        poly.addTo(S.lines);
      });
    }
    function renderParcels() {
      var p = S.parcels[S.sel];
      var tabs = S.parcels.length > 1 ? '<div class="fl-tabs" role="group" aria-label="Parcels under this field">' + S.parcels.map(function (q, i) {
        return '<button type="button" data-p="' + i + '" aria-pressed="' + (i === S.sel) + '">' + esc(q.id || 'Parcel ' + (i + 1)) + ' &middot; ' + Math.round(q.share * 100) + '%</button>';
      }).join('') + '</div>' : '';
      set('fl-parcel', '<p class="fl-note">' + (S.parcels.length > 1 ? S.parcels.length + ' parcels lie under this field. Tap one, here or on the map.' : 'The parcel under this field.') + '</p>' + tabs + '<div class="fl-p">' + FSLand.parcelHTML(p, S.svcDate) + '</div>' +
        '<h4 style="margin:.7rem 0 .2rem">Recorded transfers of this parcel</h4><div id="fl-hist"><div class="fs-loading"><span class="fs-spin"></span>reading</div></div>');
      var b = document.getElementById('fl-parcel');
      if (b) Array.prototype.forEach.call(b.querySelectorAll('[data-p]'), function (el) { el.addEventListener('click', function () { S.sel = +el.getAttribute('data-p'); renderParcels(); drawParcels(); }); });
      renderHistory();
      FSX.FIELD.land = FSX.FIELD.land || {}; FSX.FIELD.land.parcel = p;
    }
    function renderHistory() {
      var p = S.parcels[S.sel];
      if (!S.sales) { set('fl-hist', '<div class="fs-loading"><span class="fs-spin"></span>reading</div>'); return; }
      if (!S.sales.files.length) { set('fl-hist', S.noSales); return; }
      var home = S.sales.files.filter(function (f) { return f.fips === S.fips; })[0] || S.sales.files[0];
      var rows = S.sales.rows.filter(function (r) { return r.county === home.county; });
      var m = FSLand.matchTransfers(p, rows);
      FSX.FIELD.land.history = m;
      set('fl-hist', FSLand.historyHTML(m, FSLand.covOf(home)));
    }
    // ── one sale in full: tap a row, read everything on its record (Oct 18, 2026) ──
    // A sheet from the bottom on phones, a side panel on wider screens. Names come only from
    // /data/land (kept out of search by robots.txt) and show only once a reader taps a sale.
    var SD = null;
    function fileOf(r) { return ((S.sales && S.sales.files) || []).filter(function (f) { return f.fips === r.fips; })[0] || null; }
    function withMi(r) {
      if (r.mi != null || r.lat == null || !S.c) return r;
      var o = {}; for (var k in r) o[k] = r[k];
      o.mi = FSLand.milesBetween(S.c.lat, S.c.lng, r.lat, r.lng); return o;
    }
    function othersOf(r) {
      if (!S.sales || !r.pid) return [];
      var rows = S.sales.rows.filter(function (x) { return x.fips === r.fips && x.doc !== r.doc; });
      return FSLand.matchTransfers({ ids: [r.pid] }, rows);
    }
    function clearSaleMark() { if (S.saleMark && FSX.map) { FSX.map.removeLayer(S.saleMark); } S.saleMark = null; }
    function closeSale() {
      if (!SD) return;
      var d = SD; SD = null;
      document.removeEventListener('keydown', d.key, true);
      [d.bg, d.el].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
      document.body.style.overflow = d.ov || '';
      var back = d.opener && document.body.contains(d.opener) ? d.opener : document.querySelector('#fl-clist .fl-sale');
      if (back && !d.noFocus) { try { back.focus(); } catch (e) {} }
    }
    function sdSet(d, id, html) { if (SD === d) { var e = d.el.querySelector('#' + id); if (e) e.innerHTML = html; } }
    function lookupParcel(d) {
      var r = d.r, town = esc(r.muniName || 'the town');
      var pinText = r.lat != null ? 'Show on map puts a pin at the center of ' + town + ', where the sale was filed. The parcel’s own spot is not in our copy.' : 'Our copy does not place this sale on the map.';
      function none(ownerMsg) {
        d.parcel = null;
        sdSet(d, 'fl-sd-where', pinText);
        sdSet(d, 'fl-sd-owner', '<p class="fl-note">' + ownerMsg + '</p>');
        var b = SD === d && d.el.querySelector('[data-sd="map"]');
        if (b) { b.textContent = 'Show town on map'; b.disabled = r.lat == null; }
      }
      if (!r.pid) { none('There is no parcel number on this record, so we cannot look up who owns it today.'); return; }
      FSLand.registry().then(function (reg) {
        if (SD !== d) return;
        var svcs = FSLand.servicesFor(reg || {}, r.st, r.fips).filter(function (s) { return FSLand.parcelWhere(s, r.pid); });
        if (!svcs.length) { none('No free public parcel map that we have checked covers ' + esc(r.county) + ' County yet, so we do not name a current owner. The county assessor or treasurer has it.'); return; }
        var answered = 0;
        (function tryNext(i) {
          if (SD !== d) return;
          if (i >= svcs.length && !answered) { none(esc(svcs[0].name) + ' did not answer just now, so we cannot name the current owner. Tap the sale again in a minute.'); return; }
          if (i >= svcs.length) { none('Parcel ' + esc(r.pid) + ' did not come up on ' + esc(svcs[0].name) + ' (the county may write the number another way, or the parcel was split or renumbered since the sale). We do not guess an owner.'); return; }
          var svc = svcs[i];
          var url = svc.url.replace(/\/$/, '') + '/query?f=json&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=10&where=' + encodeURIComponent(FSLand.parcelWhere(svc, r.pid));
          getJSON(url, 20000).then(function (j) {
            if (SD !== d) return;
            if (!j || j.error || !j.features) throw new Error('no answer');
            answered++;
            var ps = j.features.map(function (f) { var p = FSLand.parseParcel(f.attributes, svc); p.rings = FSLand.ringsToLatLngs(f.geometry); p.svc = svc; return p; });
            var p = FSLand.pickParcel(ps, r.pid, r.county);
            if (!p) return tryNext(i + 1);
            d.parcel = p;
            sdSet(d, 'fl-sd-owner', '<div class="fl-p">' + FSLand.parcelHTML(p, null) + '</div><p class="fl-note">From the parcel map as it stands today, not from the sale record. The owner can have changed since this sale.</p>');
            var b = d.el.querySelector('[data-sd="map"]');
            if (p.rings && p.rings.length) { sdSet(d, 'fl-sd-where', 'Parcel ' + esc(p.id || r.pid) + ' is on ' + esc(svc.name) + '. Show on map outlines it.'); if (b) b.textContent = 'Show parcel on map'; }
            else { sdSet(d, 'fl-sd-where', 'The parcel map found the parcel but sent no outline. ' + pinText); if (b) { b.textContent = 'Show town on map'; b.disabled = r.lat == null; } }
          }).catch(function () { tryNext(i + 1); });
        })(0);
      });
    }
    function showOnMap(d) {
      var map = FSX.map, L = G.L, r = d.r; if (!map || !L) return;
      clearSaleMark();
      var label = 'Sale of ' + fd(r.date) + (r.price > 0 ? ', ' + fm(r.price) : '');
      var p = d.parcel;
      if (p && p.rings && p.rings.length) {
        S.saleMark = L.polygon(p.rings.map(function (ring) { return ring.map(function (q) { return [q.lat, q.lng]; }); }), { color: '#5fd3ff', weight: 3, fillOpacity: 0.15 }).addTo(map);
        S.saleMark.bindTooltip(label + ', parcel ' + (p.id || r.pid), { permanent: true, direction: 'center' });
        map.fitBounds(S.saleMark.getBounds(), { maxZoom: 16, padding: [30, 30] });
      } else if (r.lat != null) {
        S.saleMark = L.circleMarker([r.lat, r.lng], { radius: 10, color: '#5fd3ff', weight: 3, fillOpacity: 0.3 }).addTo(map);
        S.saleMark.bindTooltip(label + ': center of ' + (r.muniName || 'the town') + ', not the parcel', { permanent: true, direction: 'top' });
        map.fitBounds(L.latLngBounds([[S.c.lat, S.c.lng], [r.lat, r.lng]]), { maxZoom: 12, padding: [50, 50] });
      } else return;
      FSX.ga('fs_land_sale_map', { parcel: !!(p && p.rings && p.rings.length) });
      d.noFocus = true; closeSale();
      var m = document.getElementById('fs-map');
      if (m) { try { m.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { m.scrollIntoView(); } }
    }
    function openSale(r0, opener) {
      var keepOpener = SD ? SD.opener : opener;
      if (SD) { SD.noFocus = true; closeSale(); }
      var r = withMi(r0), file = fileOf(r) || {}, others = othersOf(r);
      var bg = document.createElement('div'); bg.className = 'fl-sd-bg';
      var el = document.createElement('div'); el.className = 'fl-sd';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'fl-sd-t');
      var head = [r.price > 0 ? fm(r.price) : 'No price', r.acres > 0 ? (+r.acres).toFixed(1) + ' ac' : null, r.ppa != null ? fm(r.ppa) + '/ac' : null].filter(Boolean).join(' &middot; ');
      el.innerHTML = '<div class="fl-sd-h"><div style="flex:1;min-width:0"><div class="fl-sd-grab" aria-hidden="true"></div><h2 id="fl-sd-t">Sale of ' + fd(r.date) + '<br><span class="fl-big" style="font-size:1rem">' + head + '</span></h2>' +
        '<p class="fl-note">' + esc([r.muniName, r.county ? r.county + ' County, ' + r.st : null].filter(Boolean).join(', ')) + '</p></div>' +
        '<button type="button" class="fl-sd-x" aria-label="Close sale details">&times;</button></div>' +
        '<p class="fl-note"><a class="fl-btn" style="display:inline-block;text-decoration:none" id="fl-sd-cr" target="_blank" rel="noopener" href="' + esc(FSLand.compReportURL({ pid: r.pid, fips: r.fips, lat: r.lat, lng: r.lng, town: true }, S.f)) + '">Comparable sales report</a> Sales near this parcel, with this list\u2019s filters.</p>' + FSLand.saleDetailHTML(r, file, others);
      document.body.appendChild(bg); document.body.appendChild(el);
      var d = { r: r, el: el, bg: bg, opener: keepOpener, ov: document.body.style.overflow, parcel: null };
      document.body.style.overflow = 'hidden';
      d.key = function (e) {
        if (SD !== d) return;
        if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeSale(); return; }
        if (e.key === 'Tab') {
          var f = Array.prototype.filter.call(el.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'), function (x) { return x.offsetParent !== null || x === document.activeElement; });
          if (!f.length) return;
          var a = f[0], z = f[f.length - 1];
          if (e.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
          else if (!e.shiftKey && (document.activeElement === z || !el.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
        }
      };
      document.addEventListener('keydown', d.key, true);
      bg.addEventListener('click', closeSale);
      el.querySelector('.fl-sd-x').addEventListener('click', closeSale);
      el.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-sd],[data-other]') : null; if (!t) return;
        if (t.getAttribute('data-sd') === 'map') showOnMap(d);
        else { var m = others[+t.getAttribute('data-other')]; if (m) openSale(m.r || m); }
      });
      SD = d;
      el.querySelector('.fl-sd-x').focus();
      lookupParcel(d);
      FSX.ga('fs_land_sale_open', { st: r.st });
    }
    FSLand.openSale = openSale; FSLand.closeSale = closeSale;
    function renderComps() {
      if (!S.sales || !S.sales.rows.length) return;
      var f = S.f, list = FSLand.filterComps(S.sales.rows, f, S.c), med = FSLand.medianPpa(list);
      FSX.FIELD.land = FSX.FIELD.land || {}; FSX.FIELD.land.comps = { list: list.slice(0, 25), med: med, f: JSON.parse(JSON.stringify(f)) };
      var unsure = list.filter(function (r) { return r.acUnsure; }).length;
      var left = unsure ? ' ' + unsure + (unsure === 1 ? ' sale' : ' sales') + ' on several parcels with uncertain acres ' + (unsure === 1 ? 'is' : 'are') + ' listed without $/acre and left out of the middle.' : '';
      S.list = list;
      set('fl-clist', (med ? '<p><span class="fl-big">' + fm(med.ppa) + '/ac</span> <span class="fl-note">middle of ' + med.n + ' sales below with known acres.' + left + '</span></p>' : '<p class="fl-note">Fewer than 3 sales with known acres match; no middle price shown.' + left + '</p>') +
        (list.length ? '<p class="fl-note">Tap a sale for everything on its record.</p>' : '') + FSLand.compsTable(list, 40, { detail: true }));
      var crp = document.getElementById('fl-comprep');
      if (crp && S.pts) crp.setAttribute('href', FSLand.compReportURL({ pts: S.pts }, S.f));
      var rep = document.getElementById('fl-report');
      if (rep) { var base = rep.getAttribute('data-base') || rep.getAttribute('href'); rep.setAttribute('data-base', base); var cf = FSLand.encodeFilter(S.f); rep.setAttribute('href', base + (cf ? '&cf=' + encodeURIComponent(cf) : '')); }
      var b = document.getElementById('fl-clist');
      if (b) Array.prototype.forEach.call(b.querySelectorAll('[data-sale]'), function (el) {
        el.addEventListener('click', function () { var r = S.list[+el.getAttribute('data-sale')]; if (r) openSale(r, el); });
      });
      if (b) Array.prototype.forEach.call(b.querySelectorAll('tr[data-row]'), function (tr) {
        tr.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('button,a')) return; var x = tr.querySelector('[data-sale]'); if (x) x.click(); });
      });
      if (b) Array.prototype.forEach.call(b.querySelectorAll('[data-sort]'), function (el) {
        el.addEventListener('click', function () { var k = el.getAttribute('data-sort'); if (S.f.sort === k) S.f.dir = S.f.dir === 'asc' ? 'desc' : 'asc'; else { S.f.sort = k; S.f.dir = k === 'mi' ? 'asc' : 'desc'; } renderComps(); });
      });
    }
    function compsShell(files) {
      var f = files[0], cov = f.coverage || {};
      var yrs = [1, 2, 3, 5, 10];
      return '<div class="fl-filt">' +
        '<label>Within (miles)<input type="number" inputmode="numeric" min="1" max="60" data-f="maxMi" value="' + (S.f.maxMi || '') + '"></label>' +
        '<label>Sold since<select data-f="since"><option value="">any date</option>' + yrs.map(function (y) { var d = new Date(); d.setFullYear(d.getFullYear() - y); var v = d.toISOString().slice(0, 10); return '<option value="' + v + '"' + (S.f.since === v ? ' selected' : '') + '>last ' + y + ' yr</option>'; }).join('') + '</select></label>' +
        '<label>Acres, at least<input type="number" inputmode="numeric" min="0" data-f="minAc" value="' + (S.f.minAc != null ? S.f.minAc : '') + '"></label>' +
        '<label>Acres, at most<input type="number" inputmode="numeric" min="0" data-f="maxAc" value="' + (S.f.maxAc != null ? S.f.maxAc : '') + '"></label>' +
        '<label>$/acre, at least<input type="number" inputmode="numeric" min="0" data-f="minPpa"></label>' +
        '<label>$/acre, at most<input type="number" inputmode="numeric" min="0" data-f="maxPpa"></label>' +
        '<label>Class<select data-f="cls"><option value="">farm, forest, undeveloped</option><option value="4">Agricultural only</option><option value="5M,6">Forest</option><option value="5">Undeveloped</option><option value="7">With farm buildings</option></select></label>' +
        '<label>Deeds<select data-f="all"><option value="">market sales</option><option value="1">every deed type</option></select></label>' +
        '</div><div id="fl-clist"></div>' +
        '<p class="fl-note"><a class="fl-btn" style="display:inline-block;text-decoration:none" id="fl-comprep" href="#" target="_blank" rel="noopener">Comparable sales report</a> Numbered comps, map, search stated, print or CSV. Free.</p>' +
        '<p class="fl-note">' + esc(f.source || 'State transfer returns') + '. ' + (FSLand.coverageText(cov, f.state) ? esc(FSLand.coverageText(cov, f.state)) + '. ' : '') + 'Price is what the return lists for the whole sale, buildings included unless the class is bare land. Miles run from your field to the center of the town where the sale was filed, not to the parcel. Market sales leave out quit claims, gifts, sales between related parties, court and partition deeds, and fee-exempt transfers.</p>';
    }
    function wireFilters() {
      var b = body(); if (!b) return;
      Array.prototype.forEach.call(b.querySelectorAll('[data-f]'), function (el) {
        el.addEventListener('change', function () {
          var k = el.getAttribute('data-f'), v = el.value;
          if (k === 'cls') S.f.cls = v ? v.split(',') : null;
          else if (k === 'since') S.f.since = v || null;
          else if (k === 'all') S.f.all = !!v;
          else S.f[k] = v === '' ? null : +v;
          renderComps();
        });
      });
    }
    function layerButtons() {
      return '<div class="fl-tabs" role="group" aria-label="Map layers">' + Object.keys(FSLand.LAYERS).map(function (k) {
        return '<button type="button" class="fl-btn" data-lyr="' + k + '" aria-pressed="' + (!!S.layers[k]) + '">' + esc(FSLand.LAYERS[k].t) + '</button>';
      }).join('') + '</div>';
    }
    function toggleLayer(k, btn) {
      var map = FSX.map, d = FSLand.LAYERS[k]; if (!map || !d || !FSLand.ArcLayer) return;
      if (S.layers[k]) { map.removeLayer(S.layers[k]); S.layers[k] = null; }
      else { S.layers[k] = new FSLand.ArcLayer(d.url, { opacity: k === 'relief' ? 0.55 : 0.7, maxZoom: 19, attribution: d.src, zIndex: 450 }).addTo(map); }
      if (btn) btn.setAttribute('aria-pressed', String(!!S.layers[k]));
      FSX.ga('fs_land_layer', { layer: k, on: !!S.layers[k] });
    }

    function run(poly) {
      S.gen = FSX.fieldGen; S.sel = 0; S.parcels = []; S.sales = null; S.list = [];
      closeSale(); clearSaleMark();
      var pts = FSX.latlngs(poly).map(function (q) { return { lat: q.lat, lng: q.lng }; });
      S.pts = pts; S.c = FSLand.centroid(pts);
      FSX.FIELD.land = { pts: pts };
      if (S.lines && FSX.map) { FSX.map.removeLayer(S.lines); S.lines = null; }
      var b = body(); if (!b) return;
      b.innerHTML = '<div id="fl-parcel"><div class="fs-loading"><span class="fs-spin"></span>reading parcel lines</div></div>' +
        '<h4 style="margin:.9rem 0 .2rem">Sold land nearby</h4><div id="fl-comps"><div class="fs-loading"><span class="fs-spin"></span>reading</div></div>' +
        '<h4 style="margin:.9rem 0 .2rem">Flood, wetlands, terrain</h4>' + layerButtons() + '<div id="fl-flood"><div class="fs-loading"><span class="fs-spin"></span>reading</div></div><div id="fl-wet"></div><div id="fl-relief"></div>' +
        '<p class="fl-note"><a class="fl-btn" style="display:inline-block;text-decoration:none" id="fl-report" href="/field-report?f=' + encodeURIComponent(pts.map(function (q) { return q.lat.toFixed(5) + ',' + q.lng.toFixed(5); }).join('~')) + '" target="_blank" rel="noopener">Printable land report</a> Free, no sign-up.</p>';
      Array.prototype.forEach.call(b.querySelectorAll('[data-lyr]'), function (el) { el.addEventListener('click', function () { toggleLayer(el.getAttribute('data-lyr'), el); }); });

      FSLand.floodAt(pts).then(function (z) { if (live()) { FSX.FIELD.land.flood = z; set('fl-flood', FSLand.floodHTML(z)); } }, function () { if (live()) set('fl-flood', FSLand.floodHTML(null)); });
      FSLand.wetAt(pts).then(function (w) { if (live()) { FSX.FIELD.land.wet = w; set('fl-wet', FSLand.wetHTML(w)); } }, function () { if (live()) set('fl-wet', FSLand.wetHTML(null)); });
      FSLand.reliefAt(pts).then(function (r) {
        if (!live() || !r) return; FSX.FIELD.land.relief = r;
        set('fl-relief', '<p class="fl-note">Ground height ' + r.lo.toLocaleString() + ' to ' + r.hi.toLocaleString() + ' ft across ' + r.n + ' points in the field (' + (r.hi - r.lo) + ' ft of relief), USGS 3DEP.</p>');
      });

      Promise.all([FSLand.registry(), waitCounty(20000)]).then(function (x) {
        if (!live()) return;
        var reg = x[0] || {}, co = x[1];
        if (!co) { set('fl-parcel', '<div class="fl-empty"><b>We could not place this field in a county.</b><p class="fl-note">Parcel lines and sales need the county. Try the field again in a minute.</p></div>'); set('fl-comps', ''); return; }
        S.st = co.abbr;
        return (co.fips ? Promise.resolve(co.fips) : fipsOf(co.abbr, co.name)).then(function (fips) {
          if (!live()) return;
          S.fips = fips;
          var svcs = FSLand.servicesFor(reg, co.abbr, fips);
          var links = ((reg.links || {})[co.abbr] || []).concat(((reg.countyLinks || {})[fips] || []));
          var empty = FSLand.parcelEmpty(co.st, co.name, links);
          var emptyHTML = '<div class="fl-empty"><b>' + esc(empty.title) + '</b><p class="fl-note">' + esc(empty.body) + '</p>' + (links.length ? '<p class="fl-note fl-links">' + links.map(function (l) { return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.t) + '</a>'; }).join(' &middot; ') + '</p>' : '') + '</div>';
          // sales first or in parallel: they do not need the parcel
          S.noSales = '<p class="fl-note">We do not hold ' + esc(co.st) + ' transfer records yet. ' + esc(((reg.salesNote || {})[co.abbr]) || 'Sales are public at the county recorder; some states publish them, and we add a state only when its data is free and checked.') + '</p>';
          FSLand.loadSales(co.abbr, S.c, fips, 40).then(function (s) {
            if (!live()) return;
            S.sales = s;
            if (!s.files.length) { set('fl-comps', S.noSales); }
            else { set('fl-comps', compsShell(s.files)); wireFilters(); renderComps(); }
            if (S.parcels.length) renderHistory();
          });
          if (!svcs.length) { set('fl-parcel', emptyHTML); return; }
          (function tryNext(i) {
            if (i >= svcs.length) { set('fl-parcel', '<div class="fl-empty"><b>The parcel service did not answer.</b><p class="fl-note">' + esc(svcs[0].name) + ' is free and public but did not reply just now. Tap the field again in a minute.</p>' + (svcs[0].about ? '<p class="fl-note fl-links"><a href="' + esc(svcs[0].about) + '" target="_blank" rel="noopener">Open the source</a></p>' : '') + '</div>'); return; }
            FSLand.queryParcels(svcs[i], pts).then(function (ps) {
              if (!live()) return;
              ps = FSLand.shareInParcels(pts, ps).slice(0, 12);
              if (!ps.length) { set('fl-parcel', '<div class="fl-empty"><b>No parcel came back for this spot.</b><p class="fl-note">' + esc(svcs[i].name) + ' has no parcel under this outline. Road and water strips are often left out.</p></div>'); return; }
              S.parcels = ps; FSLand.serviceDate(svcs[i]).then(function (d) { S.svcDate = d; if (live() && S.parcels.length) renderParcels(); });
              renderParcels(); drawParcels();
              FSX.ga('fs_land_parcel', { st: co.abbr, n: ps.length });
            }, function () { tryNext(i + 1); });
          })(0);
        });
      });
    }
    function clear() { if (S.lines && FSX.map) { FSX.map.removeLayer(S.lines); S.lines = null; } closeSale(); clearSaleMark(); S.gen = null; }
    return { run: run, clear: clear, toggleLayer: toggleLayer };
  };
})(typeof window !== 'undefined' ? window : globalThis);
