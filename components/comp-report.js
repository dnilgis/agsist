/* /comp-report: free comparable sales report for bankers, appraisers and buyers (Oct 18, 2026).
   One shared page driven by the link (CLAUDE.md: no per-parcel files). Nothing is stored.

   Link (every part optional except a subject):
     f=<field outline, the Field Scout share encoding>   or   lat=<>&lon=<>   or   pid=<parcel>&fips=<county>
     at=town     the lat/lon are the center of the town a sale was filed in, not the parcel
     r=25        search radius, miles (1 to 60)
     from=YYYY-MM-DD | from=any     to=YYYY-MM-DD      deed dates (default: the last 3 years, through today)
     amin=10  amax=     acres
     cls=4,5M   property classes (Wisconsin codes; Illinois farm is 4)
     all=1      every deed type, not only market sales
     n=15       comps listed (1 to 40)      sort=mi (nearest, default) | date (newest)

   The top half (CR) is plain functions so test/comp-report.test.mjs runs them in node.
   The rest draws the page. Recorded sales come from data/land/<st>/<fips>.json (see
   field-scout-land.js); owner and parcel outline from the free public parcel services in
   data/land/parcel-services.json; soils and crop history through the Field Scout worker;
   county context from data/atlas/counties/<fips>.json.
   Soil productivity: the USDA NCCPI read the printable land report makes. When fx/layers1's
   soils module is on the page (window.FSLayers.soilFor(ring) returning {nccpi, csr2}), it is
   used first; see soilFor below. */
(function (G) {
  'use strict';
  var NODE = typeof module === 'object' && module.exports;
  var F = NODE ? require('../field-scout-land.js') : G.FSLand;
  var CR = {};
  var num = F.num, fm = F.fmtMoney, fd = F.fmtDate;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  CR.esc = esc;

  CR.DEF = { r: 25, amin: 10, years: 3, n: 15 };
  CR.LIMITS = { r: [1, 60], n: [1, 40] };
  CR.ST = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  // State FIPS prefix to postal code, for a pid+fips link with no state.
  CR.STFIPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY' };

  function isoOK(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return false; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; }
  CR.yearsBefore = F.yearsBefore;
  function dec(s) { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return ''; } }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // The link to the report settings. today: YYYY-MM-DD (the default date range runs back from it).
  CR.parseParams = function (search, today) {
    var q = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return; var i = kv.indexOf('=');
      q[dec(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : dec(kv.slice(i + 1));
    });
    var P = { subject: null, notes: [], pid: null, fips: null };
    if (q.pid != null) { var pid = F.clean(q.pid); if (pid && pid.length <= 60 && /^[A-Za-z0-9 .\-\/]+$/.test(pid) && F.parcelKeys(pid)) P.pid = pid; else P.notes.push('The parcel number on this link could not be read.'); }
    if (/^\d{5}$/.test(q.fips || '')) P.fips = q.fips;
    if (q.f) {
      var pts = F.decodeField(q.f);
      if (pts) P.subject = { kind: 'field', pts: pts, c: F.centroid(pts) };
      else P.notes.push('The field outline on this link could not be read.');
    }
    if (!P.subject && q.lat != null && q.lon != null) {
      var la = num(q.lat), ln = num(q.lon);
      if (la != null && ln != null && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0)) P.subject = { kind: q.at === 'town' ? 'town' : 'point', c: { lat: la, lng: ln } };
      else P.notes.push('The spot on this link could not be read.');
    }
    if (!P.subject && P.pid && P.fips) P.subject = { kind: 'parcel', c: null };
    var r = num(q.r);
    P.r = r != null && r > 0 ? clamp(r, CR.LIMITS.r[0], CR.LIMITS.r[1]) : CR.DEF.r;
    if (q.from === 'any') P.from = null;
    else P.from = isoOK(q.from) ? q.from : CR.yearsBefore(today, CR.DEF.years);
    P.to = isoOK(q.to) ? q.to : today;
    P.today = today;
    if (P.from && P.to && P.from > P.to) { var t = P.from; P.from = P.to; P.to = t; }
    var a0 = num(q.amin), a1 = num(q.amax);
    P.amin = q.amin === '' || q.amin === 'any' ? null : (a0 != null && a0 >= 0 ? a0 : CR.DEF.amin);
    P.amax = a1 != null && a1 > 0 ? a1 : null;
    if (P.amin != null && P.amax != null && P.amin > P.amax) { var u = P.amin; P.amin = P.amax; P.amax = u; }
    var cls = String(q.cls || '').split(/[,.\s]+/).filter(function (c) { return /^[0-9A-Z]{1,3}$/i.test(c); }).map(function (c) { return c.toUpperCase(); });
    P.cls = cls.length ? cls : null;
    P.all = q.all === '1';
    var n = num(q.n);
    P.n = n != null && n >= 1 ? clamp(Math.round(n), CR.LIMITS.n[0], CR.LIMITS.n[1]) : CR.DEF.n;
    P.sort = q.sort === 'date' ? 'date' : 'mi';
    P.ok = !!P.subject;
    return P;
  };

  // The same settings written out in full, so the link reproduces the report exactly.
  CR.toQuery = function (P) {
    var b = [], s = P.subject || {};
    if (s.kind === 'field' && s.pts) b.push('f=' + encodeURIComponent(s.pts.map(function (q) { return q.lat.toFixed(5) + ',' + q.lng.toFixed(5); }).join('~')));
    else if (s.c && (s.kind === 'point' || s.kind === 'town')) { b.push('lat=' + s.c.lat.toFixed(5), 'lon=' + s.c.lng.toFixed(5)); if (s.kind === 'town') b.push('at=town'); }
    if (P.pid) b.push('pid=' + encodeURIComponent(P.pid));
    if (P.fips) b.push('fips=' + P.fips);
    b.push('r=' + P.r, 'from=' + (P.from || 'any'));
    if (P.to) b.push('to=' + P.to);
    b.push('amin=' + (P.amin != null ? P.amin : 'any'));
    if (P.amax != null) b.push('amax=' + P.amax);
    if (P.cls) b.push('cls=' + P.cls.join(','));
    if (P.all) b.push('all=1');
    b.push('n=' + P.n, 'sort=' + P.sort);
    return b.join('&');
  };

  // The settings as a list a reviewer can read and repeat.
  // The address the printed QR holds: the site's own address for this exact report.
  CR.reportUrl = function (P) { return 'https://agsist.com/comp-report?' + CR.toQuery(P); };

  CR.paramsRows = function (P) {
    var s = P.subject || {};
    var at = s.kind === 'field' ? 'Center of the field outline (' + s.pts.length + ' points)' :
      s.kind === 'town' ? 'Center of the town the subject sale was filed in (the parcel has no point in our copy)' :
      s.kind === 'point' ? 'The spot on the link' : 'The parcel outline from the parcel map, else the county center';
    return [
      ['Measured from', at + (s.c ? ': ' + s.c.lat.toFixed(5) + ', ' + s.c.lng.toFixed(5) : '')],
      ['Radius', P.r + ' miles, to the center of the town or township where each sale was filed'],
      ['Deed dates', P.from && P.to ? fd(P.from) + ' to ' + fd(P.to) : P.from ? fd(P.from) + ' to the newest record' : P.to ? 'through ' + fd(P.to) : 'any date'],
      ['Acres', P.amin != null && P.amax != null ? P.amin + ' to ' + P.amax : P.amin != null ? P.amin + ' or more' : P.amax != null ? 'up to ' + P.amax : 'any'],
      ['Property class', P.cls ? F.classLabel(P.cls.join(' '), P.st) + ' (' + P.cls.join(', ') + ')' : 'any class in our file'],
      ['Deed types', P.all ? 'every deed type' : 'market sales only'],
      ['Listed', 'the ' + P.n + ' ' + (P.sort === 'date' ? 'newest' : 'nearest (newest first among ties)') + ' that match']
    ];
  };

  // Recorded sales to comps, with the count left after each step, by the one market-sale rule
  // (field-scout-land.js). subjIds: the subject's parcel numbers; its own sales are left out.
  // all: every sale that matched (the summary is figured from these); list: the P.n listed.
  CR.selectComps = function (rows, P, origin, subjIds, today) {
    today = today || P.today || F.today();
    var fun = [], raw = rows || [];
    fun.push({ t: 'Recorded transfers in the counties searched', n: raw.length });
    var cur = F.saleRows(raw, today);
    var g = cur.filter(function (r) { return r.grp; }).length;
    fun.push({ t: 'one row per sale: repeated copies of one record kept once, and deeds of one parcel filed within ' + F.GROUP_DAYS + ' days counted as one sale' +
      (g ? ' (' + g + (g === 1 ? ' sale was' : ' sales were') + ' filed as several deeds)' : ''), n: cur.length });
    function stage(t, fn) { var n0 = cur.length; cur = cur.filter(fn); fun.push({ t: typeof t === 'function' ? t(n0 - cur.length) : t, n: cur.length }); }
    stage('with a price and acres on the record', function (r) { return num(r.price) > 0 && (num(r.acres) > 0 || r.acUnsure); });
    stage('not dated after today; a later date is a typo on the return', function (r) { return !(String(r.date || '').slice(0, 10) > today); });
    if (!P.all) stage('market sales: quit claims, gifts, related parties, court, sheriff, foreclosure, trade, partition and fee-exempt transfers left out', function (r) {
      return !F.screen(r, today).some(function (k) { return k === 'exempt' || k === 'related' || k === 'deed'; });
    });
    if (!P.all) stage('whole interests: sales of an undivided, fractional or less than full share left out', function (r) { return !F.partial(r); });
    if (P.from || P.to) stage('deed dated ' + (P.from ? fd(P.from) : 'any time') + ' to ' + (P.to ? fd(P.to) : 'the newest record'), function (r) {
      var d = String(r.date || '').slice(0, 10); return !!d && (!P.from || d >= P.from) && (!P.to || d <= P.to);
    });
    if (P.amin != null || P.amax != null) stage('acres ' + (P.amin != null && P.amax != null ? P.amin + ' to ' + P.amax : P.amin != null ? P.amin + ' or more' : 'up to ' + P.amax) + ' (sales with uncertain acres drop out here)', function (r) {
      var a = num(r.acres); if (a == null || a <= 0) return false;
      return (P.amin == null || a >= P.amin) && (P.amax == null || a <= P.amax);
    });
    if (P.cls) stage('class ' + P.cls.join(', '), function (r) {
      var have = String(r.cls || '').toUpperCase().split(/[\s,;/]+/);
      return P.cls.some(function (c) { return have.indexOf(c) >= 0; });
    });
    cur = cur.map(function (r) {
      var o = {}; for (var k in r) o[k] = r[k];
      o.ppa = o.ppa != null ? o.ppa : F.perAcre(o.price, o.acres);
      o.mi = origin && r.lat != null && r.lng != null ? F.milesBetween(origin.lat, origin.lng, r.lat, r.lng) : null;
      return o;
    });
    stage(function (d) { return 'with a location to measure from' + (d ? ': ' + d + ' left out, no location in the record (no town or township point)' : ''); }, function (o) { return o.mi != null; });
    stage('within ' + P.r + ' miles (town or township center)', function (o) { return o.mi <= P.r; });
    var own = [];
    if (subjIds && subjIds.length) {
      own = F.matchTransfers({ ids: subjIds }, cur).filter(function (m) { return m.how !== 'uncertain'; }).map(function (m) { return m.r; });
      stage('not a sale of the subject parcel itself', function (o) { return own.indexOf(o) < 0; });
    }
    cur.sort(function (a, b) {
      if (P.sort !== 'date' && a.mi !== b.mi) return a.mi - b.mi;
      var x = String(a.date || ''), y = String(b.date || '');
      if (x !== y) return x < y ? 1 : -1;
      return String(a.doc || '') < String(b.doc || '') ? 1 : -1;
    });
    var list = cur.slice(0, P.n);
    list.forEach(function (o, i) { o.no = i + 1; });
    fun.push({ t: 'listed below: the ' + (P.sort === 'date' ? 'newest' : 'nearest') + ' ' + list.length + (cur.length > list.length ? ' (the summary uses all ' + cur.length + ')' : ''), n: list.length });
    return { list: list, all: cur, funnel: fun, matched: cur.length, own: own };
  };

  function median(v) { var m = v.length >> 1; return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2); }
  CR.quarterOf = function (iso) { var m = /^(\d{4})-(\d{2})/.exec(String(iso || '')); return m ? m[1] + ' Q' + (Math.floor((+m[2] - 1) / 3) + 1) : null; };
  // n, middle, low and high $/acre of the sales with a usable $/acre (F.statOK: known, and not
  // under the floor). Nothing under 3. By quarter: the count every quarter, a middle only where a
  // quarter holds 3 or more. No fitted line.
  CR.stats = function (rows) {
    rows = rows || [];
    var known = rows.filter(F.statOK);
    var v = known.map(function (r) { return r.ppa; }).sort(function (a, b) { return a - b; });
    var unsure = rows.filter(function (r) { return r.ppa == null; }).length, low = rows.filter(F.lowPpa).length;
    if (v.length < 3) return { n: v.length, unsure: unsure, low: low, withheld: true };
    var q = {};
    known.forEach(function (r) { var k = CR.quarterOf(r.date); if (k) (q[k] = q[k] || []).push(r.ppa); });
    var qs = Object.keys(q).sort().map(function (k) { var a = q[k].sort(function (x, y) { return x - y; }); return { q: k, n: a.length, med: a.length >= 3 ? median(a) : null }; });
    var ac = known.map(function (r) { return +r.acres; }).sort(function (a, b) { return a - b; });
    var ds = known.map(function (r) { return String(r.date || '').slice(0, 10); }).filter(Boolean).sort();
    return { withheld: false, n: v.length, unsure: unsure, low: low, med: median(v), lo: v[0], hi: v[v.length - 1], q: qs, acMed: Math.round(median(ac.map(function (x) { return Math.round(x * 10); })) / 10), d0: ds[0], d1: ds[ds.length - 1] };
  };
  // The summary of every matched sale: bare land (no buildings on the record) in the tiles,
  // sales with buildings on a line of their own. Illinois declarations do not say whether
  // buildings sold, so there every sale is in the tiles and the page says so.
  CR.summary = function (rows) {
    rows = rows || [];
    var imp = rows.filter(function (r) { return F.hasBuildings(r.cls); }), bare = rows.filter(function (r) { return !F.hasBuildings(r.cls); });
    var s = CR.stats(bare);
    s.total = rows.length; s.nImp = imp.length; s.imp = imp.length ? CR.stats(imp) : null;
    s.noBldg = rows.some(function (r) { return !F.buildingsKnown(r.st); });
    s.grp = rows.filter(function (r) { return r.grp; }).length;
    return s;
  };

  // The arm's-length screen in words (the forms do not state arm's length; this is our rule,
  // the one market-sale rule in field-scout-land.js, shared with Field Scout and the Atlas).
  CR.PARTIAL = F.PARTIAL;
  CR.partial = F.partial;
  CR.screenText = function (r, today) {
    var why = F.notMarketWhy(r, today);
    return why.length ? 'No: ' + why.join('; ') : 'Passes (market sale by our rule)';
  };

  // ── CSV of the comps ───────────────────────────────────────────────
  CR.CSV_COLS = ['No', 'Deed date', 'Recorded', 'Price', 'Acres', 'Price per acre', 'Parcel number', 'Parcels in sale', 'Section township range', 'Legal description',
    'Town', 'County', 'State', 'Class', 'Deed type', 'Arms length screen', 'Related parties', 'Fee exempt', 'Seller as recorded', 'Buyer as recorded',
    'Miles to town center', 'Miles to parcel', 'Soil productivity NCCPI', 'Document', 'Source', 'Flags', 'Verified with a party'];
  function cell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+@\t\r-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;   // a spreadsheet must not read a name as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  CR.csv = function (list, names, today) {
    var out = [CR.CSV_COLS.join(',')];
    (list || []).forEach(function (r) {
      out.push([r.no, r.date || '', r.rec || '', num(r.price) > 0 ? Math.round(r.price) : '', r.acres > 0 ? +r.acres : (r.acUnsure ? 'uncertain' : ''), r.ppa != null ? r.ppa : '',
        r.pid || '', +r.np || 1, F.strOf(r.legal) || '', F.clean(r.legal), r.muniName || '', r.county || '', r.st || '', F.classLabel(r.cls, r.st), r.conv || '',
        CR.screenText(r, today), F.relatedParty(r) ? 'yes' : 'not marked', r.exempt ? 'yes' : 'no', names ? (r.grantor || '') : 'not in our copy', names ? (r.grantee || '') : 'not in our copy',
        r.mi != null ? r.mi.toFixed(1) : '', r.pmi != null ? r.pmi.toFixed(1) : '', r.soil && r.soil.np != null ? Math.round(r.soil.np * 100) : '', r.doc || '', r.src || '', CR.flags(r).join('; '), 'unverified'].map(cell).join(','));
    });
    return out.join('\r\n') + '\r\n';
  };

  // ── soils (the worker answers SSURGO rows: [.., .., name, acres, class, .., nccpi, .., .., .., csr2]) ──
  CR.soilOf = function (d) {
    var rows = d && d.Table; if (!rows || !rows.length) return null;
    var cl = rows.map(function (r) { return { name: r[2] || r[1], ac: parseFloat(r[3]) || 0, nicc: parseInt(r[4], 10) || null, nccpi: r[6] == null || r[6] === '' ? null : parseFloat(r[6]), csr2: d.ext && r[10] != null && r[10] !== '' ? parseFloat(r[10]) : null }; });
    var tot = cl.reduce(function (a, x) { return a + x.ac; }, 0);
    function wavg(k) { var s = 0, a = 0; cl.forEach(function (x) { if (x[k] != null && isFinite(x[k]) && x.ac > 0) { s += x[k] * x.ac; a += x.ac; } }); return a > 0 && a >= 0.5 * tot ? s / a : null; }
    return { np: wavg('nccpi'), cs: wavg('csr2'), tot: tot, top: cl.slice().sort(function (a, b) { return b.ac - a.ac; }).slice(0, 6) };
  };
  CR.soilText = function (s) {
    if (!s) return null;
    var b = [];
    if (s.np != null) b.push(Math.round(s.np * 100) + '/100 NCCPI');
    if (s.cs != null) b.push('CSR2 ' + s.cs.toFixed(1));
    return b.length ? b.join(', ') : null;
  };

  // ── the map (inline SVG, prints as drawn) ──────────────────────────
  // Plate carree with the longitude squeezed by cos(latitude): fine at county scale.
  CR.frame = function (pts, w, h, pad) {
    var la = pts.map(function (p) { return p.lat; }), ln = pts.map(function (p) { return p.lng; });
    var a0 = Math.min.apply(null, la), a1 = Math.max.apply(null, la), b0 = Math.min.apply(null, ln), b1 = Math.max.apply(null, ln);
    var k = Math.cos((a0 + a1) / 2 * Math.PI / 180);
    var dw = Math.max((b1 - b0) * k, 1e-4), dh = Math.max(a1 - a0, 1e-4);
    var s = Math.min((w - 2 * pad) / dw, (h - 2 * pad) / dh);
    var ox = (w - dw * s) / 2, oy = (h - dh * s) / 2;
    return { w: w, h: h, s: s, k: k, x: function (lng) { return ox + (lng - b0) * k * s; }, y: function (lat) { return h - oy - (lat - a0) * s; }, pxPerMile: s / 69.05 };
  };
  // Comps at one spot (one town center) sit in a ring around it, each with a short line in.
  CR.place = function (list, fr) {
    var groups = {};
    list.forEach(function (r) {
      var at = r.ploc || (r.lat != null ? { lat: r.lat, lng: r.lng } : null);
      if (!at) { r._xy = null; return; }
      var x = fr.x(at.lng), y = fr.y(at.lat), key = Math.round(x / 6) + ',' + Math.round(y / 6);
      (groups[key] = groups[key] || { x: x, y: y, m: [] }).m.push(r);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], n = g.m.length;
      if (n === 1) { g.m[0]._xy = { x: g.x, y: g.y, ax: g.x, ay: g.y, rad: 0 }; return; }
      var rad = Math.max(16, n * 23 / (2 * Math.PI));
      g.m.forEach(function (r, i) { var a = -Math.PI / 2 + 2 * Math.PI * i / n; r._xy = { x: g.x + rad * Math.cos(a), y: g.y + rad * Math.sin(a), ax: g.x, ay: g.y, rad: rad }; });
    });
    return list;
  };
  function ringPath(ring, fr) { return ring.map(function (p, i) { return (i ? 'L' : 'M') + fr.x(p[0]).toFixed(1) + ' ' + fr.y(p[1]).toFixed(1); }).join('') + 'Z'; }
  // o: { c, rings (subject outline, [{lat,lng}]), list, r, counties (GeoJSON features), towns: [{name,lat,lng}], w, h }
  CR.mapSVG = function (o) {
    var w = o.w || 720, h = o.h || 560, c = o.c;
    var dLat = o.r / 69.05, dLng = o.r / (69.17 * Math.cos(c.lat * Math.PI / 180));
    var mLat = 4 / 69.05, mLng = 4 / (69.17 * Math.cos(c.lat * Math.PI / 180));
    var box = o.fit === 'radius' ? [{ lat: c.lat - dLat, lng: c.lng - dLng }, { lat: c.lat + dLat, lng: c.lng + dLng }] : [{ lat: c.lat - mLat, lng: c.lng - mLng }, { lat: c.lat + mLat, lng: c.lng + mLng }];
    (o.list || []).forEach(function (r) { var at = r.ploc || (r.lat != null ? r : null); if (at) box.push({ lat: at.lat, lng: at.lng }); });
    var fr = CR.frame(box, w, h, 48);
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" class="cr-svg" role="img" aria-labelledby="cr-map-t">',
      '<title id="cr-map-t">Map of the subject and ' + (o.list || []).length + ' numbered comparable sales</title>',
      '<defs><clipPath id="cr-clip"><rect x="0" y="0" width="' + w + '" height="' + h + '"/></clipPath></defs>',
      '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#fbfaf6"/>', '<g clip-path="url(#cr-clip)">'];
    (o.counties || []).forEach(function (f) {
      var g = f.geometry; if (!g) return;
      var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      var d = polys.map(function (p) { return p.map(function (r) { return ringPath(r, fr); }).join(''); }).join('');
      out.push('<path d="' + d + '" fill="none" stroke="#b9b3a4" stroke-width="1"/>');
      var ct = f._ctr;
      if (ct) { var x = fr.x(ct[0]), y = fr.y(ct[1]); if (x > 40 && x < w - 40 && y > 20 && y < h - 20) out.push('<text x="' + x.toFixed(0) + '" y="' + y.toFixed(0) + '" font-size="12" fill="#8c8576" text-anchor="middle" font-style="italic">' + esc(f.properties && f.properties.name) + ' Co.</text>'); }
    });
    var cx = fr.x(c.lng), cy = fr.y(c.lat), rr = o.r * fr.pxPerMile;
    out.push('<ellipse cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + rr.toFixed(1) + '" ry="' + rr.toFixed(1) + '" fill="none" stroke="#6b6458" stroke-width="1.2" stroke-dasharray="6 5"/>');
    (o.towns || []).forEach(function (t) { out.push('<circle cx="' + fr.x(t.lng).toFixed(1) + '" cy="' + fr.y(t.lat).toFixed(1) + '" r="2.5" fill="#6b6458"/>'); });
    if (o.rings && o.rings.length) o.rings.forEach(function (ring) { out.push('<path d="' + ringPath(ring.map(function (p) { return [p.lng, p.lat]; }), fr) + '" fill="#c0392b" fill-opacity=".25" stroke="#c0392b" stroke-width="1.5"/>'); });
    CR.place(o.list || [], fr);
    (o.list || []).forEach(function (r) {
      var p = r._xy; if (!p) return;
      if (p.ax !== p.x || p.ay !== p.y) out.push('<line x1="' + p.ax.toFixed(1) + '" y1="' + p.ay.toFixed(1) + '" x2="' + p.x.toFixed(1) + '" y2="' + p.y.toFixed(1) + '" stroke="#6b6458" stroke-width=".8"/>');
      var solid = !!r.ploc;
      out.push('<g data-no="' + r.no + '"><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="10" fill="' + (solid ? '#1f2a14' : '#ffffff') + '" stroke="#1f2a14" stroke-width="1.6"/>' +
        '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + 4).toFixed(1) + '" font-size="11" font-weight="700" text-anchor="middle" fill="' + (solid ? '#ffffff' : '#1f2a14') + '">' + r.no + '</text></g>');
    });
    (o.towns || []).forEach(function (t) {
      var x = fr.x(t.lng), y = fr.y(t.lat), rad = 0;
      (o.list || []).forEach(function (r) { if (r._xy && Math.abs(r._xy.ax - x) < 4 && Math.abs(r._xy.ay - y) < 4) rad = Math.max(rad, r._xy.rad || 0); });
      out.push('<text x="' + x.toFixed(1) + '" y="' + (y + rad + 24).toFixed(1) + '" font-size="11" fill="#3a352d" text-anchor="middle" stroke="#fbfaf6" stroke-width="3" paint-order="stroke">' + esc(String(t.name || '').replace(/ (town|township)$/i, ' ($1)')) + '</text>');
    });
    var s = 10;
    out.push('<path d="M' + cx + ' ' + (cy - s) + 'L' + (cx + s) + ' ' + cy + 'L' + cx + ' ' + (cy + s) + 'L' + (cx - s) + ' ' + cy + 'Z" fill="#c0392b" stroke="#fff" stroke-width="2" data-subject="1"/>');
    out.push('</g>');
    // scale bar and north
    var miles = [1, 2, 5, 10, 20].filter(function (m) { return m * fr.pxPerMile <= w * 0.25; }).pop() || 1, bw = miles * fr.pxPerMile;
    out.push('<g font-size="11" fill="#3a352d"><rect x="12" y="' + (h - 30) + '" width="' + (bw + 16).toFixed(1) + '" height="22" fill="#fbfaf6" fill-opacity=".85"/><line x1="20" y1="' + (h - 14) + '" x2="' + (20 + bw).toFixed(1) + '" y2="' + (h - 14) + '" stroke="#3a352d" stroke-width="2"/><text x="20" y="' + (h - 18) + '">' + miles + ' mi</text>' +
      '<text x="' + (w - 18) + '" y="22" text-anchor="middle" font-weight="700">N</text><path d="M' + (w - 18) + ' 26l-5 12h10z" fill="#3a352d"/></g>');
    out.push('<rect x=".5" y=".5" width="' + (w - 1) + '" height="' + (h - 1) + '" fill="none" stroke="#8c8576"/></svg>');
    return out.join('');
  };

  // ── the comps table (plain strings) ─────────────────────────────────
  // Rows that share a town or township center tie on distance: then every town-center distance
  // shows as whole miles, marked approximate, and the note says what it is measured to.
  CR.milesTie = function (list) {
    var seen = {};
    return (list || []).some(function (r) { if (r.mi == null || r.ploc) return false; var k = (+r.lat).toFixed(4) + ',' + (+r.lng).toFixed(4); if (seen[k]) return true; seen[k] = 1; return false; });
  };
  CR.milesText = function (r, tie) {
    if (r.mi == null) return '';
    if (tie && !r.ploc) return r.mi < 0.5 ? 'under 1' : 'about ' + Math.round(r.mi);
    return r.mi < 0.5 ? '&lt;1' : r.mi.toFixed(1);
  };
  // Flags a reader must see on a sale: a filing in several deeds, a $/acre far under the range,
  // one parcel of more acres than a section.
  CR.flags = function (r) {
    var b = [];
    if (r.grp) b.push(F.groupText(r));
    if (F.lowPpa(r)) b.push(F.LOW_TEXT);
    if (r.acBig) b.push(r.acBig + ' acres on one parcel, more than a section; acres uncertain');
    return b;
  };
  CR.compsHTML = function (list, names, today) {
    if (!list.length) return '<p class="fl-note">No recorded sale matches these settings. Widen the radius, the dates or the acres.</p>';
    var tie = CR.milesTie(list);
    var head = '<thead role="rowgroup"><tr role="row">' + [['No.', 'n'], ['Deed date'], ['Price', 'n'], ['Acres', 'n'], ['$/acre', 'n'], ['Miles', 'n'], ['Town'], ['Class'], ['Soil']].map(function (h) {
      return '<th scope="col" role="columnheader"' + (h[1] ? ' class="n"' : '') + '>' + esc(h[0]) + '</th>';
    }).join('') + '</tr></thead>';
    var cell = function (cls, l, html) { return '<td role="cell"' + (cls ? ' class="' + cls + '"' : '') + ' data-l="' + l + '">' + html + '</td>'; };
    return '<table class="cr-tbl" role="table" aria-label="Comparable sales, numbered as on the map">' + head + list.map(function (r) {
      var ac = r.acres > 0 ? (+r.acres).toFixed(1) : r.acUnsure ? '<span title="acres uncertain">uncertain</span>' : '';
      var soil = r.soil === undefined ? '<span class="cr-dim cr-wait">reading</span>' : CR.soilText(r.soil) || '<span class="cr-dim">' + esc(r.soilWhy || 'not available') + '</span>';
      var str = F.strOf(r.legal);
      var form = r.st === 'IL' ? 'declaration' : r.st === 'IN' ? 'sales disclosure form' : 'return';
      var who = names ? 'Seller ' + esc(r.grantor || 'not in the record') + ' &rarr; buyer ' + esc(r.grantee || 'not in the record') : 'Seller and buyer not in our copy';
      var det = ['Parcel ' + esc(r.pid || 'not in the record') + (+r.np > 1 ? ' (first of ' + (+r.np) + ' on the ' + form + ')' : ''),
        str ? esc(str) : null, esc(r.conv || 'deed type not in the record'), 'Arm’s-length screen: ' + esc(CR.screenText(r, today)), who,
        r.pmi != null ? 'parcel located on the parcel map, ' + r.pmi.toFixed(1) + ' mi from the subject' : null,
        r.rec ? 'recorded ' + fd(r.rec) : null, r.doc ? esc(F.docLabel(r.st)) + ' ' + esc(r.doc) : null].filter(Boolean).join(' &middot; ');
      var flags = CR.flags(r);
      var leg = F.clean(r.legal);
      return '<tbody class="cr-c" data-no="' + r.no + '"><tr role="row">' + cell('n cr-no', 'No.', r.no) + cell('', 'Deed date', fd(r.date)) + cell('n', 'Price', fm(r.price)) + cell('n', 'Acres', ac) +
        cell('n', '$/acre', r.ppa != null ? fm(r.ppa) : '') + cell('n cr-mi', 'Miles', CR.milesText(r, tie)) + cell('', 'Town', esc(r.muniName || '') + (r.county ? '<span class="cr-dim">, ' + esc(r.county) + ' Co.</span>' : '')) +
        cell('', 'Class', esc(F.classLabel(r.cls, r.st)) + (F.hasBuildings(r.cls) ? ' <span class="cr-flag">buildings</span>' : '')) + cell('cr-soil', 'Soil', soil) + '</tr>' +
        '<tr class="cr-d" role="row"><td role="cell" aria-hidden="true"></td><td role="cell" colspan="8">' + (flags.length ? '<div class="cr-flagl">' + flags.map(function (f) { return '<span class="cr-flag">' + esc(f) + '</span>'; }).join(' ') + '</div>' : '') + det + (leg ? '<div class="cr-leg">' + esc(leg) + '</div>' : '') + '</td></tr></tbody>';
    }).join('') + '</table>' +
      (tie ? '<p class="fl-note">Miles run to the center of the town or township where each sale was filed, so sales filed in one town show the same distance. They are whole miles and approximate.</p>' : '') +
      '<p class="fl-note"><b>' + F.UNVERIFIED + '</b></p>';
  };

  // The summary, from every matched sale. o: { matched, listed, sort, newest (newest sale in our copy) }
  // or the number listed.
  CR.summaryHTML = function (s, o) {
    if (typeof o !== 'object' || !o) o = { matched: s.total != null ? s.total : o, listed: o };
    var matched = o.matched != null ? o.matched : s.total, listed = o.listed != null ? o.listed : matched;
    var bare = s.noBldg ? '' : 'bare-land ';
    var count = '<p class="cr-cnt">' + matched.toLocaleString('en-US') + (matched === 1 ? ' sale' : ' sales') + ' matched' + (listed < matched ? '; the ' + listed + ' ' + (o.sort === 'date' ? 'newest' : 'nearest') + ' are listed below' : '; all are listed below') + '.</p>';
    var notes = [];
    if (s.noBldg) notes.push('Illinois records do not say whether buildings were included, so these figures cover every matched sale.');
    if (s.low) notes.push(s.low + (s.low === 1 ? ' sale is' : ' sales are') + ' under ' + fm(F.PPA_FLOOR) + ' an acre: listed and marked, but left out of the middle, the low and the high.');
    if (s.unsure) notes.push(s.unsure + (s.unsure === 1 ? ' sale has' : ' sales have') + ' no $/acre (acres uncertain, or one sale filed as several deeds that do not add up to one whole) and ' + (s.unsure === 1 ? 'is' : 'are') + ' left out of the figures.');
    if (s.withheld) {
      return count + '<p class="cr-held"><b>No summary.</b> ' + (s.n ? 'Only ' + s.n + ' matched ' + bare + (s.n === 1 ? 'sale has' : 'sales have') + ' a usable $/acre.' : 'No matched ' + bare + 'sale has a usable $/acre.') + ' A middle, low and high price per acre needs at least 3. Widen the settings.</p>' +
        (notes.length ? '<p class="fl-note">' + esc(notes.join(' ')) + '</p>' : '') + CR.impHTML(s);
    }
    var lead = '<p class="cr-lead">Typical ' + bare + 'price paid near you: <b>' + fm(s.med) + '/ac</b>, ' + s.n + ' sales, dated ' + fd(s.d0) + ' to ' + fd(s.d1) + (o.newest ? ', newest sale in our copy ' + fd(o.newest) : '') + '.</p>';
    var tiles = [[s.noBldg ? 'Sales with a $/acre' : 'Bare-land sales with a $/acre', String(s.n)], ['Middle (median) $/acre', fm(s.med)], ['Low $/acre', fm(s.lo)], ['High $/acre', fm(s.hi)], ['Middle size', s.acMed + ' ac']];
    var q = '<table class="cr-q"><thead><tr><th scope="col">Quarter (deed date)</th><th scope="col" class="n">Sales</th><th scope="col" class="n">Middle $/acre</th></tr></thead><tbody>' + s.q.map(function (x) {
      return '<tr><td>' + esc(x.q) + '</td><td class="n">' + x.n + '</td><td class="n">' + (x.med != null ? fm(x.med) : '<span class="cr-dim">under 3 sales</span>') + '</td></tr>';
    }).join('') + '</tbody></table>';
    return lead + count + '<div class="cr-tiles">' + tiles.map(function (t) { return '<div><span>' + esc(t[0]) + '</span><b>' + esc(t[1]) + '</b></div>'; }).join('') + '</div>' + CR.impHTML(s) +
      '<p class="fl-note">' + esc(notes.join(' ')) + (notes.length ? ' ' : '') + 'Prices are as recorded for the whole sale; nothing is adjusted for time, size, soil or improvements.</p>' +
      '<h3>By quarter</h3>' + q + '<p class="fl-note">A middle is shown only for a quarter with 3 or more sales. No trend line is fitted: ' + s.n + ' sales spread over these quarters cannot carry one.</p>';
  };
  // Sales with buildings, on a line of their own.
  CR.impHTML = function (s) {
    if (s.noBldg || !s.nImp) return '';
    var i = s.imp;
    return '<p class="cr-imp">Sales with buildings (a house or farm buildings on the record): ' + s.nImp + (i && !i.withheld ? ', middle ' + fm(i.med) + '/ac on ' + i.n + ' with a $/acre.' : ', too few with a $/acre for a middle.') + ' Not in the figures above.</p>';
  };

  if (NODE) { module.exports = CR; return; }
  G.CompReport = CR;

  // ════════════════════════════════════════════════════════════════════
  // The page. Everything below runs in the browser only.
  // ════════════════════════════════════════════════════════════════════
  var FS_WORKER = 'https://agsist-fieldscout.dnilgis.workers.dev';
  // States whose sales may exist under data/land/<st>/index.json; the page asks for each and
  // names only the ones that answer, so a newly added state shows up on its own.
  var MAYBE = ['WI', 'IL', 'IN', 'MN', 'IA', 'FL', 'NY', 'MD', 'VT', 'NJ', 'CT'];
  function $(id) { return document.getElementById(id); }
  function set(id, h) { var e = $(id); if (e) e.innerHTML = h; }
  function note(t) { return '<p class="fl-note">' + t + '</p>'; }
  function getJSON(url, ms, opt) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms || 20000) : null;
    opt = opt || {}; if (ctrl) opt.signal = ctrl.signal;
    return fetch(url, opt).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(String(r.status)); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  function today() { return F.today(); }
  // A link from a county file goes on the page only when it is a plain web address.
  function safeURL(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : null; }
  // Whatever is still "reading" when something fails for good says it did not load.
  function finishLoading(why) {
    Array.prototype.forEach.call(document.querySelectorAll('#cr-body .fs-loading'), function (e) { var p = e.parentNode; if (p) p.innerHTML = note(esc(why || 'Did not load. Reload in a minute.')); });
  }
  function ringWKT(ring) { var r = ring.map(function (p) { return p.lng.toFixed(6) + ' ' + p.lat.toFixed(6); }); r.push(r[0]); return 'POLYGON((' + r.join(',') + '))'; }
  function bigRing(rings) { return (rings || []).slice().sort(function (a, b) { return F.ringAcres(b) - F.ringAcres(a); })[0] || null; }
  // Soil productivity of an outline. fx/layers1 hook first, then the Field Scout worker (SSURGO).
  function soilFor(ring) {
    if (G.FSLayers && typeof G.FSLayers.soilFor === 'function') {
      return Promise.resolve(G.FSLayers.soilFor(ring)).then(function (s) { return s && (s.nccpi != null || s.csr2 != null) ? { np: s.nccpi, cs: s.csr2, top: s.top || [] } : null; });
    }
    return getJSON(FS_WORKER + '/soil', 25000, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wkt: ringWKT(ring) }) }).then(CR.soilOf);
  }
  function pip(pt, poly) { var x = pt.lng, y = pt.lat, ins = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
  function polysOf(f) { var g = f.geometry; return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function bboxOf(f) { var b = [180, 90, -180, -90]; polysOf(f).forEach(function (p) { p[0].forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); }); }); return b; }

  function start() {
    if (!F) { $('cr-none').hidden = false; set('cr-none', '<b>This page did not finish loading.</b> Check the connection and reload.'); return; }
    F.addCSS();
    var P = CR.parseParams(location.search, today());
    $('cr-date').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    $('cr-print').addEventListener('click', function () { window.print(); });
    if (!P.ok) { $('cr-none').hidden = false; $('cr-print').hidden = true; $('cr-csv').hidden = true; if (P.notes.length) set('cr-none-why', esc(P.notes.join(' '))); return; }
    $('cr-body').hidden = false;
    $('cr-csv').hidden = true;   // shown once there are comps to download
    var S = { P: P, subj: P.subject, parcels: [], list: [] };
    var link = location.origin + location.pathname + '?' + CR.toQuery(P);
    set('cr-params', '<table class="fl-kv">' + CR.paramsRows(P).map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<p class="fl-note">This exact report: <a href="' + esc(link) + '" class="cr-link">' + esc(link) + '</a></p>');
    // printed only: a QR top right of page 1 that opens this same report (every setting in it)
    if (G.AgPrintQR) { G.AgPrintQR.addCSS(); set('cr-pq', G.AgPrintQR.html(CR.reportUrl(P), 'agsist.com/comp-report')); }
    if (S.subj.kind === 'field') $('cr-back').href = '/field-scout#f=' + S.subj.pts.map(function (q) { return q.lat.toFixed(5) + ',' + q.lng.toFixed(5); }).join('~');

    // A link from Field Scout carries the county, so the 2 MB county map is needed only for the map's lines.
    var geoP = getJSON('/data/atlas/counties.geo.json', 40000).catch(function () { S.geoFail = true; return null; });
    var regP = F.registry();
    Promise.all([geoP, regP]).then(function (x) {
      var geo = x[0], reg = x[1] || {};
      S.geo = geo; S.reg = reg;
      // county: from the link, else the county the subject point falls in
      var co = null;
      if (P.fips && geo) co = (geo.features || []).filter(function (f) { return String(f.id) === P.fips; })[0] || null;
      if (!co && S.subj.c && geo) co = (geo.features || []).filter(function (f) { return polysOf(f).some(function (p) { return pip(S.subj.c, p[0]); }); })[0] || null;
      if (!co) {
        var abbr = P.fips ? CR.STFIPS[P.fips.slice(0, 2)] : null;
        if (!abbr) {
          if (S.geoFail) { set('cr-sum', note('The county map did not load, so we could not tell which county this spot is in. Reload in a minute.')); hideAll(true); finishLoading('Did not load: the county map did not answer. Reload in a minute.'); return; }
          set('cr-sum', note('This spot did not fall in a US county we know, so there are no recorded sales to compare.')); hideAll(true); finishLoading('Not available for this spot.'); return;
        }
        co = { id: P.fips, properties: { st: abbr, name: '' } };
      }
      S.fips = String(co.id); S.st = co.properties.st; S.county = co.properties.name; S.stName = CR.ST[S.st] || S.st;
      $('cr-h').textContent = 'Comparable sales' + (S.county ? ', ' + S.county + ' County, ' + S.stName : ', ' + S.stName);
      return findSubjectParcel().then(function () {
        if (!S.subj.c) {   // parcel link whose parcel did not come back: the county center, said so
          var b = bboxOf(co); S.subj.c = { lat: (b[1] + b[3]) / 2, lng: (b[0] + b[2]) / 2 }; S.subj.kind = 'county';
        }
        renderSubject();
        loadAtlas(); loadCDL(); subjectSoil();
        return F.loadSales(S.st, S.subj.c, S.fips, P.r + F.REACH_PAD).then(function (s) {
          S.sales = s;
          if (!S.county && s.ix && s.ix.counties) { var k = s.ix.counties.filter(function (x) { return x.fips === S.fips; })[0]; if (k) { S.county = k.name; $('cr-h').textContent = 'Comparable sales, ' + S.county + ' County, ' + S.stName; } }
          if (!s.ix || !s.files.length) return noData(s);
          run();
        });
      });
    }).catch(function (e) { set('cr-sum', note('Something did not load (' + esc(e && e.message || 'error') + '). Reload in a minute.')); finishLoading(); });

    // keepSum: the summary section stays to say why there is nothing
    function hideAll(keepSum) { (keepSum ? [] : ['cr-sec-sum']).concat(['cr-sec-map', 'cr-sec-comps']).forEach(function (id) { var e = $(id); if (e) e.hidden = true; }); }

    // ── subject parcel: under the field, at the spot, or by parcel number ──
    function findSubjectParcel() {
      var svcs = F.servicesFor(S.reg, S.st, S.fips);
      S.svcs = svcs;
      if (!svcs.length) return Promise.resolve();
      var pts = S.subj.pts;
      if (!pts && S.subj.c && S.subj.kind === 'point') { var c = S.subj.c, e = 0.00004; pts = [{ lat: c.lat - e, lng: c.lng - e }, { lat: c.lat - e, lng: c.lng + e }, { lat: c.lat + e, lng: c.lng + e }, { lat: c.lat + e, lng: c.lng - e }]; }
      var timedOut = false;   // after the 15 s cap a late answer is ignored, so the subject and the miles never change under a drawn table
      var cap = new Promise(function (ok) { setTimeout(function () { timedOut = true; ok(); }, 15000); });
      var work = new Promise(function (ok) {
        (function tryNext(i) {
          if (timedOut) return ok();
          if (i >= svcs.length) { S.parcelErr = svcs[0].name + ' did not answer just now.'; return ok(); }
          var q;
          if (P.pid && (S.subj.kind === 'parcel' || S.subj.kind === 'town')) {
            var where = F.parcelWhere(svcs[i], P.pid); if (!where) return tryNext(i + 1);
            q = getJSON(svcs[i].url.replace(/\/$/, '') + '/query?f=json&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=10&where=' + encodeURIComponent(where), 20000).then(function (j) {
              if (!j || j.error || !j.features) throw new Error('no answer');
              var ps = j.features.map(function (f) { var p = F.parseParcel(f.attributes, svcs[i]); p.rings = F.ringsToLatLngs(f.geometry); p.svc = svcs[i]; return p; });
              var p = F.pickParcel(ps, P.pid, S.county);
              return p ? [p] : [];
            });
          } else if (pts) {
            q = F.queryParcels(svcs[i], pts).then(function (ps) { return S.subj.pts ? F.shareInParcels(pts, ps).slice(0, 6) : ps.slice(0, 1); });
          } else return ok();
          q.then(function (ps) {
            if (timedOut) return ok();
            S.parcels = ps; S.parcelSvc = svcs[i];
            var p = ps[0];
            if (p && p.rings && p.rings.length && !S.subj.pts) { S.subj.rings = [bigRing(p.rings)]; var cc = F.centroid(S.subj.rings[0]); if (S.subj.kind !== 'point') { S.subj.c = cc; S.subj.kind = 'parcel'; } }
            if (!ps.length) S.parcelErr = 'No parcel came back from ' + svcs[i].name + (P.pid ? ' for parcel ' + P.pid + ' (the county may write it another way, or it was split or renumbered).' : ' at this spot.');
            ok();
          }, function () { if (timedOut) return ok(); tryNext(i + 1); });
        })(0);
      });
      return Promise.race([work, cap.then(function () { if (!S.parcels.length && !S.parcelErr) S.parcelErr = 'The parcel map was slow to answer.'; })]);
    }
    function subjIds() {
      var ids = [];
      if (P.pid) ids.push(P.pid);
      S.parcels.forEach(function (p) { (p.ids || []).forEach(function (i) { if (ids.indexOf(i) < 0) ids.push(i); }); });
      return ids;
    }
    function renderSubject() {
      var s = S.subj, rows = [];
      function kv(k, v) { if (v) rows.push('<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>'); }
      kv('County', esc((S.county ? S.county + ' County, ' : '') + S.stName));
      kv('Where', s.kind === 'field' ? 'Field outline from Field Scout, ' + F.ringAcres(s.pts).toFixed(1) + ' acres drawn' : s.kind === 'parcel' ? 'Parcel outline from the parcel map' : s.kind === 'town' ? 'Center of the town the sale was filed in; the parcel did not come up on a parcel map' : s.kind === 'county' ? '<span class="fl-warn">County center: parcel ' + esc(P.pid) + ' did not come up on a parcel map, so distances run from the middle of the county</span>' : 'A spot on the map');
      kv('Center', s.c ? s.c.lat.toFixed(5) + ', ' + s.c.lng.toFixed(5) : '');
      if (P.pid && !S.parcels.length) kv('Parcel number', esc(P.pid) + ' <span class="fl-note">(from the link)</span>');
      var h = '<table class="fl-kv">' + rows.join('') + '</table>';
      if (S.parcels.length) h += (S.parcels.length > 1 ? note(S.parcels.length + ' parcels lie under this outline, largest share first.') : '') + S.parcels.map(function (p) { return '<div class="fl-p">' + F.parcelHTML(p, null) + '</div>'; }).join('') + note('Owner and acres from the parcel map as it stands today.');
      else if (!S.svcs || !S.svcs.length) { var e = F.parcelEmpty(S.stName, S.county, ((S.reg.links || {})[S.st] || [])); h += note(esc(e.body)); }
      else if (S.parcelErr) h += note(esc(S.parcelErr) + ' No owner is named.');
      set('cr-subject', h);
    }
    function subjectSoil() {
      var ring = S.subj.pts || (S.subj.rings && S.subj.rings[0]);
      if (!ring) { set('cr-soil', note('No outline for the subject, so no soil read. Open the report from a field or a parcel the parcel map knows.')); return; }
      soilFor(ring).then(function (s) {
        if (!s) { set('cr-soil', note('No soil survey is published for this spot.')); return; }
        var t = CR.soilText(s);
        set('cr-soil', (t ? '<p><b class="cr-big">' + esc(t) + '</b></p>' : '') + '<table class="cr-q"><thead><tr><th>Soil</th><th class="n">Acres</th><th class="n">Class</th></tr></thead><tbody>' +
          s.top.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="n">' + (x.ac > 0 ? x.ac.toFixed(1) : '') + '</td><td class="n">' + (x.nicc || '') + '</td></tr>'; }).join('') + '</tbody></table>' +
          note('Weighted by acres in the outline. NCCPI is USDA’s National Commodity Crop Productivity Index (0 to 100); class is land capability, 1 best to 8. USDA NRCS soil survey (SSURGO).'));
      }).catch(function () { set('cr-soil', note('The soil survey did not answer. Reload in a minute.')); });
    }
    function loadCDL() {
      var c = S.subj.c;
      if (S.subj.kind === 'town' || S.subj.kind === 'county') { set('cr-cdl', note('Crop history needs the subject’s own spot; this link has only a ' + (S.subj.kind === 'town' ? 'town' : 'county') + ' center.')); return; }
      getJSON(FS_WORKER + '/cdl?lat=' + c.lat.toFixed(5) + '&lon=' + c.lng.toFixed(5) + '&years=10', 20000).then(function (d) {
        var hh = d && (d.history && d.history.length ? d.history : d.rotation);
        if (!hh || !hh.length) { set('cr-cdl', note('USDA crop history did not resolve for this spot.')); return; }
        set('cr-cdl', '<div class="frp-rot">' + hh.slice(0, 10).map(function (x) { return '<span><b>' + esc(x.year) + '</b> ' + esc(x.crop || ('code ' + x.code)) + '</span>'; }).join('') + '</div>' + note('At the subject center, USDA NASS Cropland Data Layer, newest first.'));
      }).catch(function () { set('cr-cdl', note('USDA crop history did not answer.')); });
    }
    function loadAtlas() {
      getJSON('/data/atlas/counties/' + S.fips + '.json', 15000).then(function (a) {
        var v = a.value || {}, r = a.rent || {}, rows = [];
        function kv(k, x, n) { rows.push('<tr><th>' + esc(k) + '</th><td>' + x + (n ? '<div class="fl-note">' + n + '</div>' : '') + '</td></tr>'); }
        if (v.status === 'ok' && v.latest) kv('Census land and buildings value', fm(v.latest) + '/acre (' + v.latest_year + ')', 'USDA Census of Agriculture, what operators reported, buildings included. Not a sale price.' + (v.flag ? ' <span class="fl-warn">The ' + v.latest_year + ' figure ' + esc(v.flag.dir) + ' ' + Math.abs(v.flag.own_pct) + '% while ' + v.flag.n + ' neighboring counties moved a median ' + v.flag.nb_pct + '%; read with care.</span>' : ''));
        else kv('Census land and buildings value', '<span class="cr-dim">not published</span>');
        if (r.status === 'ok' && r.nonirr) kv('Cash rent, non-irrigated cropland', fm(r.nonirr.value) + '/acre (' + r.nonirr.year + ')', 'USDA NASS county cash rents survey.');
        else kv('Cash rent, non-irrigated cropland', '<span class="cr-dim">not published for this county</span>');
        var rv = v.rent_to_value || {};
        if (rv.pct != null) kv('Rent as a share of census value', rv.pct + '% (' + rv.year + ')', fm(rv.rent) + ' rent over ' + fm(rv.value) + ' value, same year, gross.');
        else kv('Rent as a share of census value', '<span class="cr-dim">' + esc(rv.status || 'not figured') + '</span>');
        set('cr-atlas', '<table class="fl-kv">' + rows.join('') + '</table>' + note('From the <a href="/farmland-atlas">AGSIST Farmland Atlas</a> county record.'));
      }).catch(function () { set('cr-atlas', note('No Farmland Atlas record for this county.')); });
    }

    // ── comps ─────────────────────────────────────────────────────────
    function run() {
      var sel = CR.selectComps(S.sales.rows, P, S.subj.c, subjIds(), P.today);
      S.sel = sel; S.list = sel.list;
      S.names = S.sales.files.some(function (f) { return f.names; });
      S.newest = S.sales.files.map(function (f) { return f.coverage && f.coverage.to; }).filter(Boolean).sort().pop() || null;
      // the subject's own recorded sales
      var home = S.sales.files.filter(function (f) { return f.fips === S.fips; })[0];
      if (home && (S.parcels.length || P.pid)) {
        var homeRows = S.sales.rows.filter(function (r) { return r.fips === S.fips; });
        var ps = S.parcels.length ? S.parcels : [{ ids: [P.pid] }];
        set('cr-own', ps.map(function (p, k) { return (ps.length > 1 ? '<h4>Parcel ' + esc(p.id || k + 1) + '</h4>' : '') + F.historyHTML(F.matchTransfers(p, homeRows), F.covOf(home)); }).join(''));
      } else set('cr-own', note(home ? 'Without a parcel number for the subject we cannot pick its own transfers out of the county record.' : 'We hold no transfer file for the subject’s county.'));
      drawSummary(); drawFunnel(); drawComps(); drawMap(); drawSources();
      if (S.list.length) { $('cr-csv').hidden = false; $('cr-csv').addEventListener('click', downloadCSV); }
      G.addEventListener('beforeprint', function () { S.printing = true; drawMap(); });
      G.addEventListener('afterprint', function () { S.printing = false; drawMap(); });
      lookupComps();
    }
    function drawSummary() {
      var s = CR.summary(S.sel.all);
      set('cr-sum', CR.summaryHTML(s, { matched: S.sel.matched, listed: S.list.length, sort: P.sort, newest: S.newest }) + note('<b>Recorded sales from public records. Not an appraisal; no adjustments made.</b>'));
    }
    function drawFunnel() {
      set('cr-funnel', '<ol class="cr-fun">' + S.sel.funnel.map(function (x) { return '<li><b>' + x.n.toLocaleString('en-US') + '</b> ' + esc(x.t) + '</li>'; }).join('') + '</ol>' +
        note(esc(F.searchedText(S.sales, S.stName))));
    }
    function compsNote() {
      return note('Price is the whole sale as recorded' + (S.st === 'IL' ? '; Illinois records do not say whether buildings were included' : ', buildings included unless the class is bare land') + '. Miles run from the subject to the center of the town or township where the sale was filed, not to the parcel, unless the row says the parcel was located. Seller and buyer are as recorded on the state form.');
    }
    function drawComps() {
      set('cr-comps', '<p id="cr-status" class="fl-note" role="status" aria-live="polite"></p>' + CR.compsHTML(S.list, S.names, P.today) + compsNote());
    }
    // One comp's row again, in place (its soil and where the parcel map put it), without redrawing the table.
    function patchComp(r) {
      var old = document.querySelector('#cr-comps tbody.cr-c[data-no="' + r.no + '"]');
      if (!old) return;
      var tie = CR.milesTie(S.list), tmp = document.createElement('table');
      tmp.innerHTML = CR.compsHTML([r], S.names, P.today).replace(/^<table[^>]*>[\s\S]*?<\/thead>/, '').replace(/<\/table>[\s\S]*$/, '');
      var nb = tmp.querySelector('tbody.cr-c');
      if (!nb) return;
      var mi = nb.querySelector('.cr-mi'); if (mi) mi.innerHTML = CR.milesText(r, tie);
      old.parentNode.replaceChild(nb, old);
    }
    function drawMap() {
      var towns = {}, geo = S.geo;
      S.list.forEach(function (r) { if (r.lat != null && !r.ploc) towns[r.muniName] = { name: r.muniName, lat: r.lat, lng: r.lng }; });
      var cs = [];
      if (geo) {
        var c = S.subj.c, dLat = P.r / 69 * 1.6, dLng = dLat / Math.cos(c.lat * Math.PI / 180);
        cs = (geo.features || []).filter(function (f) { var b = f._bb || (f._bb = bboxOf(f)); return b[2] >= c.lng - dLng && b[0] <= c.lng + dLng && b[3] >= c.lat - dLat && b[1] <= c.lat + dLat; });
        cs.forEach(function (f) { if (!f._ctr) { var b = f._bb; f._ctr = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; } });
      }
      var off = S.list.filter(function (r) { return r.lat == null && !r.ploc; }).length;
      var narrow = !S.printing && (G.innerWidth || 1000) < 600;   // print always draws the full-width map
      set('cr-map', CR.mapSVG({ w: narrow ? 440 : 720, h: narrow ? 520 : 560, c: S.subj.c, rings: S.subj.pts ? [S.subj.pts] : S.subj.rings, list: S.list, r: P.r, counties: cs, towns: Object.keys(towns).map(function (k) { return towns[k]; }) }) +
        '<p class="fl-note cr-key"><span class="cr-k cr-k-s"></span> subject &nbsp; <span class="cr-k cr-k-o">1</span> comp at the center of the town or township it was filed in &nbsp; <span class="cr-k cr-k-p">1</span> comp placed on its parcel (parcel map) &nbsp; dashed ring: the ' + P.r + '-mile search radius (the map is zoomed to the comps, so part of it may run off the edge). Comps that share a town sit in a ring around its center; the line points to the town.' + (off ? ' ' + off + ' listed ' + (off === 1 ? 'sale has' : 'sales have') + ' no town point and ' + (off === 1 ? 'is' : 'are') + ' not drawn.' : '') + (geo ? ' County lines: US Census.' : ' County lines did not load.') + '</p>');
    }
    // States with a parcel map: find each comp's parcel, place it and read its soil. The table is
    // drawn once; each answer patches its own row and the map, and one status line counts them.
    function lookupComps() {
      var q = S.list.slice(), live = 0, done = 0, total = q.length, sec = $('cr-sec-comps');
      if (sec) sec.setAttribute('aria-busy', 'true');
      function status() {
        var e = $('cr-status'); if (!e) return;
        e.textContent = done < total ? 'Reading soils and parcel spots for the listed sales: ' + done + ' of ' + total + ' done.' : 'Soils and parcel spots read for all ' + total + ' listed sales.';
        if (done >= total && sec) sec.removeAttribute('aria-busy');
      }
      function finish(r, moved) { live--; done++; patchComp(r); if (moved) drawMap(); status(); next(); }
      function next() {
        if (!q.length) { if (!live) status(); return; }
        var r = q.shift(); live++;
        var svcs = F.servicesFor(S.reg, r.st, r.fips).filter(function (s) { return r.pid && F.parcelWhere(s, r.pid); });
        if (!svcs.length) { r.soil = null; r.soilWhy = r.pid ? 'no parcel map here' : 'no parcel number'; finish(r, false); return; }
        var svc = svcs[0], moved = false;
        getJSON(svc.url.replace(/\/$/, '') + '/query?f=json&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=10&where=' + encodeURIComponent(F.parcelWhere(svc, r.pid)), 20000).then(function (j) {
          if (!j || j.error || !j.features) throw new Error('no answer');
          var ps = j.features.map(function (f) { var p = F.parseParcel(f.attributes, svc); p.rings = F.ringsToLatLngs(f.geometry); return p; });
          var p = F.pickParcel(ps, r.pid, r.county);
          if (!p || !p.rings || !p.rings.length) { r.soil = null; r.soilWhy = 'parcel not found on the map'; return; }
          var ring = bigRing(p.rings); r.ploc = F.centroid(ring); r.pmi = F.milesBetween(S.subj.c.lat, S.subj.c.lng, r.ploc.lat, r.ploc.lng); moved = true;
          return soilFor(ring).then(function (s) { r.soil = s; if (!s) r.soilWhy = 'no soil survey'; }, function () { r.soil = null; r.soilWhy = 'soil survey did not answer'; });
        }).catch(function () { r.soil = null; r.soilWhy = 'parcel map did not answer'; }).then(function () { finish(r, moved); });
      }
      status();
      for (var i = 0; i < 3; i++) next();
    }
    function downloadCSV() {
      var blob = new Blob([CR.csv(S.list, S.names, P.today)], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'comparable-sales-' + (S.county || S.st).toLowerCase().replace(/[^a-z]+/g, '-') + '-' + today() + '.csv';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    function drawSources() {
      var h = S.sales.files.map(function (f) {
        var cov = F.coverageText(f.coverage, f.state);
        return '<li><b>' + esc(f.county) + ' County, ' + esc(f.state) + '</b>: ' + esc(f.source) + '. ' + (cov ? esc(cov) + '. ' : '') + (f.fetched_utc ? 'Our copy read ' + fd(String(f.fetched_utc).slice(0, 10)) + '. ' : '') +
          (f.since_note ? esc(f.since_note) + ' ' : '') + (f.links || []).map(function (l) { var u = safeURL(l.url); return u ? '<a href="' + esc(u) + '">' + esc(l.t) + '</a> <span class="cr-url">(' + esc(u.replace(/^https?:\/\//i, '')) + ')</span>' : esc(l.t); }).join(', ') + '</li>';
      }).join('');
      var has = function (st) { return S.sales.files.some(function (f) { return f.state === st; }); };
      var IL = has('IL'), WI = has('WI'), IN = has('IN');
      var price = IL ? 'Illinois: net consideration, Line 13 of PTAX-203 (full consideration less personal property), or full consideration, Line 11, when Line 13 is blank' :
        IN ? 'Indiana: the sales price on the sales disclosure form (E1) less personal property (E2)' : 'Wisconsin: the sale price on the transfer return';
      var pp = IL || IN ? 'Personal property was taken out of the price on the form; what it was is not in our copy.' : 'Any personal property in the price (machinery, grain) is not split out in our copy.';
      set('cr-src', '<p>' + esc(F.searchedText(S.sales, S.stName)) + ' Then sales within ' + P.r + ' miles of the subject.</p><ul class="cr-srcl">' + h + '</ul>' +
        '<h3>What counts and what is left out</h3><ul class="cr-srcl">' +
        '<li>A sale needs a price and acres on the record. Price is the consideration on the state form (' + price + ') and covers the real estate that sold, buildings included.</li>' +
        (P.all ? '<li>Every deed type is included on this run; the arm’s-length screen line says which would fail it.</li>' : '<li>Market sales only: quit claims, gifts, corrections, terminations and transfer-on-death deeds, sheriff, foreclosure, court-ordered, court officer and judicial deeds, partition, easements, leases, mineral and beneficial-interest transfers, trades and exchanges, highway takings, the deed that closes out a land or installment contract, sales between related parties' + (IL ? ' (Illinois Line 10b)' : '') + ', and fee-exempt transfers are left out. Auctions and sales to a neighbor stay in. The forms do not state arm’s length; this is our screen.</li>') +
        (P.all ? '' : '<li>Sales of an undivided, fractional or less than full share are left out; the price is not for the whole.</li>') +
        '<li>Repeated copies of one record count once. Deeds of one parcel filed within ' + F.GROUP_DAYS + ' days are one sale, listed once with the total price; it gets a $/acre only when every deed carries the same full acres and one buyer.</li>' +
        '<li>A sale on several parcels whose acres do not add up for sure, or one parcel of more than 640 acres, is listed with acres uncertain and no $/acre, and drops out when an acre range is set.</li>' +
        '<li>A sale under ' + fm(F.PPA_FLOOR) + ' an acre is listed and marked, and left out of the middle, the low and the high. A sale dated after today is left out.</li>' +
        '<li>The summary uses every sale that matched, not only the ones listed. Bare land is in the tiles; sales with buildings on the record get their own line.' + (IL ? ' Illinois records do not say whether buildings were included.' : '') + '</li>' +
        '<li>Distance runs to the center of the town or township where the sale was filed; our copy has no point for the parcel itself. Where a free parcel map finds the parcel by its number, the map places it there and the row says so.</li>' +
        (WI ? '<li>Wisconsin: the Department of Revenue’s public download holds about the last five years of returns.</li>' : '') +
        '<li>Seller and buyer are as recorded, cut at 80 characters in our copy. Street addresses and financing are not in our copy. ' + pp + '</li>' +
        '<li>' + esc(F.UNVERIFIED) + '</li>' +
        '<li>Soil productivity: USDA NRCS SSURGO through the Field Scout reader, weighted by acres of the outline; a comp’s outline is the parcel as mapped today, which may differ from what sold.</li></ul>' +
        '<p class="fl-note">Parcel map: ' + esc(S.parcelSvc ? S.parcelSvc.name : (S.svcs && S.svcs[0] ? S.svcs[0].name : 'none we have checked covers this county')) + '. County context: USDA Census of Agriculture and NASS cash rents through the Farmland Atlas. Crop history: USDA NASS Cropland Data Layer.</p>');
    }
    function noData(s) {
      hideAll(true);
      var noteSt = (S.reg.salesNote || {})[S.st];
      $('cr-csv').hidden = true;
      // the state's index lists counties but none of their files came back: a load failure, not a missing state
      if (s && s.ix && s.ix.counties && s.ix.counties.length) {
        set('cr-sum', '<div class="cr-held"><b>The county sales files did not load just now, so this report has no comps.</b>' + note('Reload in a minute. ' + esc(F.searchedText(s, S.stName))) + '</div>');
        set('cr-own', note('The county sales file did not load.'));
        set('cr-funnel', ''); set('cr-src', note('The county sales files did not load.'));
        return;
      }
      set('cr-own', note('No ' + esc(S.stName) + ' transfer records here to search.'));
      var srcSec = $('cr-src'); if (srcSec && srcSec.parentNode) srcSec.parentNode.hidden = true;
      set('cr-funnel', '');
      Promise.all(MAYBE.map(function (st) { return getJSON('/data/land/' + st.toLowerCase() + '/index.json', 10000).then(function (ix) { return ix && ix.counties && ix.counties.length ? st : null; }, function () { return null; }); })).then(function (have) {
        have = have.filter(Boolean).map(function (st) { return CR.ST[st] || st; });
        set('cr-sum', '<div class="cr-held"><b>We do not hold ' + esc(S.stName) + ' recorded sales yet, so this report has no comps.</b>' +
          note(esc(noteSt || 'Sales are public at the county recorder. We add a state only when its own sale records are free to read in bulk and we have checked them.')) +
          note('What this page can still give for ' + esc(S.county ? S.county + ' County' : S.stName) + ': the subject and its owner of record where a free parcel map covers it, soils, crop history, and the county’s census land value and cash rent below.') +
          (have.length ? note('Recorded sales on AGSIST now: ' + esc(have.join(', ')) + '.') : '') + '</div>');
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
