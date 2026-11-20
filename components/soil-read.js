/* The soil of a field, free (Nov 20, 2026): USDA NRCS SSURGO through Soil Data Access (SDA),
   asked straight from the reader's browser. Nothing about the reader goes to AGSIST: the field's
   outline goes only to USDA, inside the SDA query, and nothing is kept.

   Two questions, both to SDA's public REST endpoint (a form post, so the browser sends no
   preflight):
   1. the field: SSURGO map units clipped to the field outline (SDA's own GetClippedMapunits
      macro), with acres in the field, drainage class, slope, available water and NCCPI 3.0.
      Columns 0 to 14 are the Field Scout worker's, in its order (field-scout-read.js reads them by
      position), 15 to 18 are added here. CSR2 is asked as NULL: real SDA has no iacornsr column
      and no CSR interpretation (Nov 20, 2026). The corn and soybean parts of NCCPI are asked as
      its ruledepth-1 sub-rules (checked against real component rows on Nov 20, 2026).
   2. the county: every map unit of the same soil survey area with its acres in that survey area
      and the same NCCPI. The middle (acre-weighted median) and the share of rated acres
      below this field come from that answer only, so the field and the county are one source.

   Field figures: acre-weighted over the map units that carry the figure, and shown only when
   those units cover at least half the field. Nothing is filled in or carried from elsewhere.

   window.AgSoil in the browser; module.exports for the tests (test/soil-read.test.mjs). */
(function (root) {
  'use strict';
  var SDA = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NCCPI_ALL = 'NCCPI - National Commodity Crop Productivity Index (Ver 3.0)';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function num(v) { if (v == null || v === '') return null; var n = parseFloat(v); return isFinite(n) ? n : null; }
  function str(v) { return v == null || v === '' ? null : String(v); }
  function mdy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : null; }

  // ── the queries ───────────────────────────────────────────────────────────
  function okWkt(wkt) { return /^POLYGON\s*\(\(\s*[-0-9.,\s]+\)\)$/i.test(String(wkt || '')); }
  function okArea(a) { return /^[A-Z]{2}[0-9]{3}$/.test(String(a || '')); }
  function nccpiSub(mu, rule, like) {
    return '( SELECT ROUND(SUM(ci.interphr*c2.comppct_r)/NULLIF(SUM(c2.comppct_r),0),3) FROM component c2' +
      ' JOIN cointerp ci ON ci.cokey=c2.cokey WHERE c2.mukey=' + mu + ' AND ci.ruledepth=0 AND ci.mrulename' +
      (like ? " LIKE '" + rule + "%'" : " = '" + rule + "'") + ' AND ci.interphr IS NOT NULL )';
  }
  function nccpiPart(mu, rule) {
    return '( SELECT ROUND(SUM(ci.interphr*c2.comppct_r)/NULLIF(SUM(c2.comppct_r),0),3) FROM component c2' +
      ' JOIN cointerp ci ON ci.cokey=c2.cokey WHERE c2.mukey=' + mu + " AND ci.mrulename = '" + NCCPI_ALL + "'" +
      " AND ci.ruledepth=1 AND ci.rulename LIKE '" + rule + "%' AND ci.interphr IS NOT NULL )";
  }
  // CSR2 is not a component column in Soil Data Access: real SDA refuses "iacornsr" with HTTP 400
  // ("Invalid column name 'iacornsr'", Nov 20, 2026, every query). It is a cointerp
  // interpretation whose rule name and scale are being confirmed against SDA itself; until then
  // the column is asked as NULL so every other figure still loads, and the card shows no CSR2.
  function csr2Sub() { return 'CAST(NULL AS float)'; }
  // [0] areasymbol [1] musym [2] muname [3] ac [4] nicc [5] slope_pct [6] nccpi [7] nccpi_corn
  // [8] nccpi_soy [9] drainage [10] csr2 [11] farmlndcl [12] flodfreq [13] hydric_pct [14] nirrcapscl
  // [15] aws_cm (0 to 150 cm) [16] mukey [17] saverest (survey version date) [18] areaname
  function fieldQuery(wkt) {
    if (!okWkt(wkt)) throw new Error('bad outline');
    return '~DeclareGeometry(@aoi)~\n' +
      "SELECT @aoi = geometry::STGeomFromText('" + wkt + "', 4326)\n" +
      '~DeclareIdGeomTable(@clip)~\n' +
      '~GetClippedMapunits(@aoi,polygon,geo,@clip)~\n' +
      'SELECT l.areasymbol, mu.musym, mu.muname, ROUND(area.ac, 2) AS ac, ma.niccdcd AS nicc,' +
      ' ( SELECT ROUND(AVG(CAST(c.slope_r AS float)),1) FROM component c WHERE c.mukey=mu.mukey AND c.majcompflag=\'Yes\' ) AS slope_pct, ' +
      nccpiSub('mu.mukey', NCCPI_ALL) + ' AS nccpi, ' +
      // the corn and soybean parts are sub-rules of the NCCPI rule (ruledepth 1, matched on
      // rulename: "NCCPI - NCCPI Corn Submodel (I)" in IA169, the suffix may differ elsewhere),
      // listed by real SDA for mukey 2800480 on Nov 20, 2026; asked at ruledepth 0 by mrulename
      // they came back NULL on every row
      nccpiPart('mu.mukey', 'NCCPI - NCCPI Corn Submodel') + ' AS nccpi_corn, ' +
      nccpiPart('mu.mukey', 'NCCPI - NCCPI Soybeans Submodel') + ' AS nccpi_soy,' +
      ' ma.drclassdcd AS drainage, ' + csr2Sub('mu.mukey') + ' AS csr2,' +
      ' mu.farmlndcl AS farmlndcl, ma.flodfreqdcd AS flodfreq, ma.hydclprs AS hydric_pct,' +
      " ( SELECT TOP 1 c4.nirrcapscl FROM component c4 WHERE c4.mukey=mu.mukey AND c4.majcompflag='Yes' ORDER BY c4.comppct_r DESC, c4.cokey ) AS nirrcapscl," +
      ' ma.aws0150wta AS aws_cm, mu.mukey AS mukey, CONVERT(varchar(10), sc.saverest, 23) AS saverest, l.areaname AS areaname' +
      ' FROM ( SELECT id AS mukey, SUM( GEOGRAPHY::STGeomFromWKB(geom.STAsBinary(),4326).STArea() * 0.000247105 ) AS ac FROM @clip GROUP BY id ) area' +
      ' INNER JOIN mapunit mu ON mu.mukey=area.mukey INNER JOIN legend l ON l.lkey=mu.lkey' +
      ' LEFT JOIN muaggatt ma ON ma.mukey=mu.mukey LEFT JOIN sacatalog sc ON sc.areasymbol=l.areasymbol' +
      ' ORDER BY ac DESC';
  }
  // [0] areasymbol [1] areaname [2] saverest [3] mukey [4] muacres [5] nccpi [6] csr2
  function countyQuery(area) {
    if (!okArea(area)) throw new Error('bad survey area');
    return 'SELECT l.areasymbol, l.areaname, CONVERT(varchar(10), sc.saverest, 23) AS saverest, mu.mukey, mu.muacres, ' +
      nccpiSub('mu.mukey', NCCPI_ALL) + ' AS nccpi, ' + csr2Sub('mu.mukey') + ' AS csr2' +
      ' FROM legend l INNER JOIN mapunit mu ON mu.lkey=l.lkey LEFT JOIN sacatalog sc ON sc.areasymbol=l.areasymbol' +
      " WHERE l.areasymbol='" + area + "'";
  }

  // One SDA call. Resolves to the rows ([] when SDA has none), rejects on a network, CORS or
  // server failure or after ms. A form post: no preflight, no cookies.
  function askText(sql, ms, fetchFn) {
    var f = fetchFn || (typeof fetch === 'function' ? fetch.bind(root) : null);
    if (!f) return Promise.reject(new Error('no fetch'));
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 20000);
    return f(SDA, {
      method: 'POST', credentials: 'omit', signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'format=JSON&query=' + encodeURIComponent(sql)
    }).then(function (r) {
      var body = r.text ? r.text() : Promise.resolve('');
      if (!r.ok) return body.then(function (txt) { throw sdaError(r.status, txt); }, function () { throw sdaError(r.status, ''); });
      return body;
    }).then(function (txt) { clearTimeout(t); return txt || ''; }, function (e) { clearTimeout(t); throw e; });
  }
  // SDA refuses a query with an XML ServiceExceptionReport (HTTP 400 for a bad query, sometimes
  // 200): the reason goes on the card, never a blank or a stale answer.
  function decodeXml(s) {
    return String(s).replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function sdaError(status, txt) {
    var m = /<ServiceException(?:\s[^>]*)?>([\s\S]*?)<\/ServiceException>/i.exec(String(txt || ''));
    var detail = m ? decodeXml(m[1]).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean)[0] || '' : '';
    var e = new Error('sda ' + status + (detail ? ': ' + detail : ''));
    e.status = status; e.detail = detail.slice(0, 200); e.sda = true; e.raw = String(txt || '').slice(0, 4000);
    return e;
  }
  function parse(txt) {
    if (/^\s*</.test(txt || '') || /ServiceException/.test(txt || '')) throw sdaError(200, txt);
    var d = txt && txt.trim() ? JSON.parse(txt) : {};   // SDA answers an empty body when no row matches
    return d && Array.isArray(d.Table) ? d.Table : [];
  }
  // a short reason for the card: "HTTP 400: Invalid query: Invalid column name 'x'." or the kind of failure
  function reason(e) {
    if (e && e.sda) return 'HTTP ' + e.status + (e.detail ? ': ' + e.detail : '');
    if (e && e.name === 'AbortError') return 'no answer in time';
    return 'no answer: the connection failed or the browser refused the reply';
  }
  function ask(sql, ms, fetchFn) { return askText(sql, ms, fetchFn).then(parse); }
  var last = { wkt: null };
  function askField(wkt, ms, f) { last.wkt = wkt; return ask(fieldQuery(wkt), ms, f); }
  function askCounty(area, ms, f) { return ask(countyQuery(area), ms, f); }

  // ── the field ─────────────────────────────────────────────────────────────
  function units(rows) {
    return (rows || []).map(function (r) {
      return { area: str(r[0]), sym: str(r[1]), name: str(r[2]) || str(r[1]) || 'Unnamed map unit', ac: num(r[3]) || 0,
        nicc: num(r[4]), slope: num(r[5]), nccpi: num(r[6]), corn: num(r[7]), soy: num(r[8]), drainage: str(r[9]),
        csr2: num(r[10]), farm: str(r[11]), sub: str(r[14]), awsCm: num(r[15]), mukey: str(r[16]), asOf: str(r[17]), areaName: str(r[18]) };
    }).filter(function (u) { return u.ac > 0; });
  }
  // acre-weighted mean over units carrying key, only when they cover half the field or more
  function wmean(list, key, total) {
    var a = 0, s = 0;
    list.forEach(function (u) { if (u[key] != null) { a += u.ac; s += u[key] * u.ac; } });
    return a > 0 && a >= 0.5 * total ? s / a : null;
  }
  function summarize(rows) {
    var list = units(rows);
    if (!list.length) return null;
    var total = list.reduce(function (s, u) { return s + u.ac; }, 0);
    list.forEach(function (u) { u.pct = total > 0 ? u.ac / total * 100 : null; });
    var byArea = {};
    list.forEach(function (u) { if (u.area) byArea[u.area] = (byArea[u.area] || 0) + u.ac; });
    var area = Object.keys(byArea).sort(function (a, b) { return byArea[b] - byArea[a]; })[0] || null;
    var main = list.filter(function (u) { return u.area === area; })[0] || list[0];
    var w = function (k) { return wmean(list, k, total); };
    return { units: list, total: total, area: area, areaName: main.areaName, asOf: main.asOf,
      areas: Object.keys(byArea).length,
      nccpi: w('nccpi'), corn: w('corn'), soy: w('soy'), csr2: w('csr2'), awsCm: w('awsCm'), slope: w('slope') };
  }

  // ── the county (the soil survey area) ─────────────────────────────────────
  // acre-weighted median: the value at which half the rated acres are lower
  function wmedian(pairs) {
    var p = pairs.filter(function (x) { return x.v != null && x.a > 0; }).sort(function (a, b) { return a.v - b.v; });
    var tot = p.reduce(function (s, x) { return s + x.a; }, 0), run = 0;
    if (!tot) return null;
    for (var i = 0; i < p.length; i++) { run += p[i].a; if (run >= tot / 2) return p[i].v; }
    return p[p.length - 1].v;
  }
  function shareBelow(pairs, v) {
    var tot = 0, below = 0;
    pairs.forEach(function (x) { if (x.v != null && x.a > 0) { tot += x.a; if (x.v < v) below += x.a; } });
    return tot ? below / tot * 100 : null;
  }
  function county(rows) {
    if (!rows || !rows.length) return null;
    var nc = [], cs = [], acres = 0;
    rows.forEach(function (r) {
      var a = num(r[4]) || 0; acres += a;
      nc.push({ v: num(r[5]), a: a }); cs.push({ v: num(r[6]), a: a });
    });
    var rated = nc.reduce(function (s, x) { return s + (x.v != null ? x.a : 0); }, 0);
    var csRated = cs.reduce(function (s, x) { return s + (x.v != null ? x.a : 0); }, 0);
    return { area: str(rows[0][0]), name: str(rows[0][1]), asOf: str(rows[0][2]), acres: acres, rated: rated,
      nccpiMid: wmedian(nc), csr2Mid: csRated >= 0.5 * acres ? wmedian(cs) : null, nc: nc, cs: cs };
  }
  // "NCCPI 0.71, above the county's middle of 0.62: higher than 68% of rated acres in Story County, Iowa."
  function compare(s, c) {
    if (!s || !c) return [];
    var out = [], where = esc(c.name || c.area);
    function one(label, v, mid, pairs, digits, near) {
      if (v == null || mid == null) return;
      var f = function (x) { return x.toFixed(digits); };
      // compared as the printed figures, in whole hundredths, so 0.83 against 0.81 is a gap of
      // exactly 2 (floating point made it 0.0199999 and called it level)
      var sc = Math.pow(10, digits), d = Math.round(+f(v) * sc) - Math.round(+f(mid) * sc);
      var word = Math.abs(d) < Math.round(near * sc) ? 'about level with' : d > 0 ? 'above' : 'below';
      var b = shareBelow(pairs, v);
      // the place is named once; a second line says "its"
      var first = !out.length;
      out.push(label + ' ' + f(v) + ', ' + word + ' the county’s middle of ' + f(mid) +
        (b != null ? ': higher than ' + Math.round(b) + '% of ' + (first ? 'rated acres in ' + where : 'its rated acres') : first ? ' in ' + where : '') + '.');
    }
    one('NCCPI', s.nccpi, c.nccpiMid, c.nc, 2, 0.02);
    return out;
  }

  // ── words ─────────────────────────────────────────────────────────────────
  function inches(cm) { return cm == null ? null : (cm / 2.54).toFixed(1) + ' in'; }
  function sourceLine(s, c) {
    var d = mdy((c && c.asOf) || s.asOf), nm = (c && c.name) || s.areaName;
    return 'USDA NRCS SSURGO, Soil Data Access' + (d ? ', data as of ' + d : ', survey date not returned') +
      (nm ? ' (' + esc(nm) + ' soil survey)' : '') + '.';
  }
  function unitMeta(u) {
    var m = [];
    if (u.drainage) m.push(esc(u.drainage));
    if (u.slope != null) m.push(u.slope + '% slope');
    if (u.awsCm != null) m.push(inches(u.awsCm) + ' water');
    if (u.nccpi != null) m.push('NCCPI ' + u.nccpi.toFixed(2));
    if (u.nicc != null) m.push('class ' + u.nicc + (u.sub ? esc(u.sub) : ''));
    return m.join(' · ');
  }
  // The first screen of the soil card: the field's numbers, the county line, the map units, the
  // source. countyState: an object from county(), or null when it failed or was not asked.
  // The card is drawn once, when both answers are in, so nothing below it moves twice.
  function render(s, countyState, opts) {
    opts = opts || {};
    if (!s) return '<div class="fs-err">No SSURGO soil survey is published for this spot. Coverage gaps exist in parts of the West and Alaska.</div>';
    var c = countyState && typeof countyState === 'object' ? countyState : null;
    var head = [];
    // NCCPI overall is the productivity number; its corn and soybean parts follow, each only when
    // the survey rates it (confirmed against real SDA component rows, Nov 20, 2026). No CSR2:
    // Soil Data Access does not carry it.
    if (s.nccpi != null) head.push('<strong>NCCPI ' + s.nccpi.toFixed(2) + '</strong>');
    var parts = [];
    if (s.corn != null) parts.push('corn ' + s.corn.toFixed(2));
    if (s.soy != null) parts.push('soybeans ' + s.soy.toFixed(2));
    if (parts.length) head.push(cap(parts.join(', ')));
    if (s.awsCm != null) head.push(inches(s.awsCm) + ' available water in the top 5 ft');
    if (s.slope != null) head.push(Math.round(s.slope * 10) / 10 + '% average slope');
    var html = '<div class="fs-soil-top" id="fs-soil-top">' +
      (opts.directError ? '<p class="fs-err fs-soil-why">USDA Soil Data Access did not answer this browser directly (' + esc(reason(opts.directError)) +
        '), so this card shows the Field Scout server’s read of the same survey.</p>' : '') +
      '<p class="fs-soil-slope" style="margin-top:0">' + (head.length ? head.join(' · ') : 'The survey rates too little of this field for a field figure.') + '</p>';
    var cmp = c ? compare(s, c) : [];
    var cmpText = cmp.length ? cmp.join(' ')
      : c ? 'The county’s soil survey rates too little ground to compare.'
      : opts.countyError ? 'The county comparison did not load (USDA Soil Data Access: ' + esc(reason(opts.countyError)) + '). Tap the field again to retry.'
      : opts.direct ? 'The county comparison did not load. Tap the field again to retry.'
      : 'The county comparison comes straight from USDA and did not load this time.';
    html += '<p class="fs-soil-slope fs-soil-cmp" id="fs-soil-cmp">' + cmpText + '</p>';
    html += s.units.slice(0, 6).map(function (u) {
      var meta = unitMeta(u);
      return '<div class="fs-soil-row"><div class="fs-soil-info"><div class="fs-soil-name">' + esc(u.name) + '</div>' +
        (meta ? '<div class="fs-soil-meta">' + meta + '</div>' : '') + '</div>' +
        '<div class="fs-soil-pct">' + Math.round(u.pct) + '%</div></div>';
    }).join('');
    if (s.units.length > 6) html += '<p class="fs-caveat">' + (s.units.length - 6) + ' smaller map units not listed (' + Math.round(s.units.slice(6).reduce(function (a, u) { return a + u.pct; }, 0)) + '% of the field).</p>';
    html += '<p class="fs-src">' + sourceLine(s, c) + '</p></div>';
    return html;
  }
  // "How to read it", closed, at the bottom of the card.
  function howTo(s, notes) {
    return '<details class="fs-vigor-more fs-soil-how"><summary>How to read it</summary>' +
      '<p class="fs-soil-slope">Each row is a soil map unit from the USDA soil survey, with its share of the outline you set. ' +
      'Drainage class, slope, available water and the ratings are the survey’s representative values for that map unit, not a measurement of your exact acres.</p>' +
      '<p class="fs-soil-slope"><strong>NCCPI</strong> (National Commodity Crop Productivity Index, version 3.0) runs 0 to 1 on one national scale: how well the soil and climate carry dryland corn, soybeans, cotton or small grains. ' +
      'For each soil the overall figure is the highest of its crop parts; the corn and soybean parts are shown beside it, weighted by acres the same way. ' +
      'CSR2 (Iowa’s Corn Suitability Rating 2) is not shown: USDA’s Soil Data Access service does not offer it.</p>' +
      '<p class="fs-soil-slope"><strong>Available water</strong> is how much water the top 150 cm (about 5 ft) of soil can hold for a crop, in inches.</p>' +
      '<p class="fs-soil-slope"><strong>The county line</strong> compares this field with every rated acre in the same soil survey area (usually one county). The middle is the rating with half the rated acres below it. Both come from the same Soil Data Access answer, never another source.</p>' +
      (notes || '') +
      '<p class="fs-caveat">Method: two questions go from your browser straight to USDA Soil Data Access: the soil map clipped to your outline, and the survey area’s map units with their acres. Field figures are weighted by acres and shown only when rated map units cover at least half the field. When USDA answers your browser directly, your outline goes only to USDA. When it does not, the read asks again through the AGSIST Field Scout server, which passes the outline to USDA and keeps USDA’s answer for up to a week.</p>' +
      '</details>';
  }

  // ── checking real fields (developer console, never called by the page) ──
  // On /field-scout after a field is read (the page loads this file then):
  //   AgSoil.debug()                 the field on screen
  //   AgSoil.debug('POLYGON((...))') any outline, lon lat pairs, ring closed
  // Prints the two exact SQL strings the card sends and SDA's raw answers, and resolves
  // { wkt, fieldQuery, fieldRaw, area, countyQuery, countyRaw } (copy(r.fieldRaw) puts a raw
  // answer on the clipboard for a fixture). It runs in the reader's own browser only.
  function debug(wkt, fetchFn) {
    wkt = wkt || last.wkt;
    var out = { wkt: wkt, fieldQuery: fieldQuery(wkt) }, log = typeof console !== 'undefined' ? console : { log: function () {} };
    log.log('SDA endpoint: ' + SDA + ' (POST, form fields format=JSON and query)');
    log.log('askField query:\n' + out.fieldQuery);
    return askText(out.fieldQuery, 60000, fetchFn).then(function (txt) {
      out.fieldRaw = txt; log.log('askField raw answer:\n' + txt);
      var s = summarize(parse(txt));
      out.area = s && s.area;
      if (!out.area) return out;
      out.countyQuery = countyQuery(out.area);
      log.log('askCounty query:\n' + out.countyQuery);
      return askText(out.countyQuery, 60000, fetchFn).then(function (t2) {
        out.countyRaw = t2; log.log('askCounty raw answer:\n' + t2);
        return out;
      });
    }).catch(function (e) {
      // a refused query: keep SDA's own answer (status and body) for the record
      out.error = e.message; out.errorRaw = e.raw || '';
      log.log('SDA refused or failed: ' + e.message + (e.raw ? '\n' + e.raw : ''));
      return out;
    });
  }

  var API = { SDA: SDA, debug: debug, parse: parse, reason: reason, sdaError: sdaError, okWkt: okWkt, okArea: okArea, fieldQuery: fieldQuery, countyQuery: countyQuery, ask: ask,
    askField: askField, askCounty: askCounty, units: units, summarize: summarize, county: county, wmedian: wmedian,
    shareBelow: shareBelow, compare: compare, render: render, howTo: howTo, sourceLine: sourceLine, mdy: mdy };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.AgSoil = API;
})(typeof window !== 'undefined' ? window : this);
