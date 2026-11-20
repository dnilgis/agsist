/* The soil of a field, free (Nov 20, 2026): USDA NRCS SSURGO through Soil Data Access (SDA),
   asked straight from the reader's browser. Nothing about the reader goes to AGSIST: the field's
   outline goes only to USDA, inside the SDA query, and nothing is kept.

   Two questions, both to SDA's public REST endpoint (a form post, so the browser sends no
   preflight):
   1. the field: SSURGO map units clipped to the field outline (SDA's own GetClippedMapunits
      macro), with acres in the field, drainage class, slope, available water, NCCPI 3.0 (all
      crops, corn and soybean submodels) and, in Iowa, CSR2. Columns 0 to 14 are the Field Scout
      worker's, in its order (field-scout-read.js reads them by position), 15 to 18 are added here.
   2. the county: every map unit of the same soil survey area with its acres in that survey area
      and the same NCCPI and CSR2. The middle (acre-weighted median) and the share of rated acres
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
  function csr2Sub(mu) {
    return '( SELECT ROUND(SUM(CAST(c3.iacornsr AS float)*c3.comppct_r)/NULLIF(SUM(c3.comppct_r),0),1) FROM component c3' +
      ' WHERE c3.mukey=' + mu + ' AND c3.iacornsr IS NOT NULL )';
  }
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
      nccpiSub('mu.mukey', 'NCCPI - NCCPI Corn Submodel', true) + ' AS nccpi_corn, ' +
      nccpiSub('mu.mukey', 'NCCPI - NCCPI Soybeans Submodel', true) + ' AS nccpi_soy,' +
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
  function ask(sql, ms, fetchFn) {
    var f = fetchFn || (typeof fetch === 'function' ? fetch.bind(root) : null);
    if (!f) return Promise.reject(new Error('no fetch'));
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 20000);
    return f(SDA, {
      method: 'POST', credentials: 'omit', signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'format=JSON&query=' + encodeURIComponent(sql)
    }).then(function (r) {
      if (!r.ok) throw new Error('sda ' + r.status);
      return r.text();
    }).then(function (txt) {
      clearTimeout(t);
      var d = txt && txt.trim() ? JSON.parse(txt) : {};   // SDA answers an empty body when no row matches
      return d && Array.isArray(d.Table) ? d.Table : [];
    }, function (e) { clearTimeout(t); throw e; });
  }
  function askField(wkt, ms, f) { return ask(fieldQuery(wkt), ms, f); }
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
      var vv = +f(v), mm = +f(mid), d = vv - mm;
      var word = Math.abs(d) < near ? 'about level with' : d > 0 ? 'above' : 'below';
      var b = shareBelow(pairs, v);
      // the place is named once; a second line says "its"
      var first = !out.length;
      out.push(label + ' ' + f(v) + ', ' + word + ' the county’s middle of ' + f(mid) +
        (b != null ? ': higher than ' + Math.round(b) + '% of ' + (first ? 'rated acres in ' + where : 'its rated acres') : first ? ' in ' + where : '') + '.');
    }
    one('NCCPI', s.nccpi, c.nccpiMid, c.nc, 2, 0.02);
    one('CSR2', s.csr2, c.csr2Mid, c.cs, 0, 2);
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
    if (u.csr2 != null) m.push('CSR2 ' + Math.round(u.csr2));
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
    if (s.nccpi != null) head.push('<strong>NCCPI ' + s.nccpi.toFixed(2) + '</strong>' +
      (s.corn != null || s.soy != null ? ' (corn ' + (s.corn != null ? s.corn.toFixed(2) : 'not rated') + ', soybeans ' + (s.soy != null ? s.soy.toFixed(2) : 'not rated') + ')' : ''));
    if (s.csr2 != null) head.push('<strong>CSR2 ' + s.csr2.toFixed(1) + '</strong>');
    if (s.awsCm != null) head.push(inches(s.awsCm) + ' available water in the top 5 ft');
    if (s.slope != null) head.push(Math.round(s.slope * 10) / 10 + '% average slope');
    var html = '<div class="fs-soil-top" id="fs-soil-top">' +
      '<p class="fs-soil-slope" style="margin-top:0">' + (head.length ? head.join(' · ') : 'The survey rates too little of this field for a field figure.') + '</p>';
    var cmp = c ? compare(s, c) : [];
    var cmpText = cmp.length ? cmp.join(' ')
      : c ? 'The county’s soil survey rates too little ground to compare.'
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
      '<p class="fs-soil-slope"><strong>NCCPI</strong> (National Commodity Crop Productivity Index, version 3.0) runs 0 to 1 on one national scale: how well the soil and climate carry dryland corn, soybeans, cotton or small grains. The corn and soybean figures are its crop parts. ' +
      '<strong>CSR2</strong> (Iowa only, 0 to 100) is the rating Iowa land sales, rents and loans are quoted against.</p>' +
      '<p class="fs-soil-slope"><strong>Available water</strong> is how much water the top 150 cm (about 5 ft) of soil can hold for a crop, in inches.</p>' +
      '<p class="fs-soil-slope"><strong>The county line</strong> compares this field with every rated acre in the same soil survey area (usually one county). The middle is the rating with half the rated acres below it. Both come from the same Soil Data Access answer, never another source.</p>' +
      (notes || '') +
      '<p class="fs-caveat">Method: two questions go from your browser straight to USDA Soil Data Access: the soil map clipped to your outline, and the survey area’s map units with their acres. Field figures are weighted by acres and shown only when rated map units cover at least half the field. Your outline goes only to USDA, nothing is stored, and AGSIST sees none of it.</p>' +
      '</details>';
  }

  var API = { SDA: SDA, okWkt: okWkt, okArea: okArea, fieldQuery: fieldQuery, countyQuery: countyQuery, ask: ask,
    askField: askField, askCounty: askCounty, units: units, summarize: summarize, county: county, wmedian: wmedian,
    shareBelow: shareBelow, compare: compare, render: render, howTo: howTo, sourceLine: sourceLine, mdy: mdy };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.AgSoil = API;
})(typeof window !== 'undefined' ? window : this);
