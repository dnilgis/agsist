/* /field-report?f=<field outline>: one shared printable page for any field (Oct 17, 2026).
   The outline is the Field Scout share link's; nothing is stored. Every piece is read
   from its public source when the page opens and prints as missing when it does not answer. */
(function () {
  'use strict';
  var FS_WORKER = 'https://agsist-fieldscout.dnilgis.workers.dev';
  var ST = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  function $(id) { return document.getElementById(id); }
  function set(id, h) { var e = $(id); if (e) e.innerHTML = h; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function miss(t) { return '<p class="fl-note">' + t + '</p>'; }

  function start() {
    var F = window.FSLand;
    if (!F) { set('frp-none', '<b>This page did not finish loading.</b> Check the connection and reload.'); $('frp-none').hidden = false; return; }
    F.addCSS();
    var q = /[?&]f=([^&#]+)/.exec(location.search) || /#f=(.+)$/.exec(location.hash);
    var pts = q ? F.decodeField(q[1]) : null;
    $('frp-print').addEventListener('click', function () { window.print(); });
    $('frp-date').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    if (!pts) { $('frp-none').hidden = false; $('frp-print').hidden = true; return; }
    $('frp-body').hidden = false;
    var enc = pts.map(function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }).join('~');
    $('frp-back').href = '/field-scout#f=' + enc;
    var c = F.centroid(pts), acres = F.ringAcres(pts);
    var sum = [['Acres in the outline', acres.toFixed(1)], ['Center', c.lat.toFixed(4) + ', ' + c.lng.toFixed(4)]];
    function drawSum(extra) { set('frp-sum', sum.concat(extra || []).map(function (x) { return '<div><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('')); }
    drawSum();

    // county from the outline's center (Census county shapes, our own copy)
    var county = fetch('/data/atlas/counties.geo.json').then(function (r) { return r.json(); }).then(function (g) {
      function inRing(r) { var x = c.lng, y = c.lat, ins = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
      var hit = null;
      (g.features || []).some(function (f) {
        var gm = f.geometry; if (!gm) return false;
        var polys = gm.type === 'Polygon' ? [gm.coordinates] : gm.type === 'MultiPolygon' ? gm.coordinates : [];
        if (polys.some(function (p) { return inRing(p[0]); })) { hit = { fips: String(f.id), name: f.properties.name, abbr: f.properties.st, st: ST[f.properties.st] || f.properties.st }; return true; }
        return false;
      });
      return hit;
    }).catch(function () { return null; });

    county.then(function (co) {
      if (!co) { set('frp-parcel', miss('This spot did not fall in a US county, so there are no parcel lines or sales to show.')); set('frp-hist', ''); set('frp-comps', ''); return; }
      $('frp-h').textContent = acres.toFixed(0) + '-acre field, ' + co.name + ' County, ' + co.st;
      drawSum([['County', co.name + ', ' + co.abbr]]);
      Promise.all([F.registry(), F.loadSales(co.abbr, c, co.fips, 40)]).then(function (x) {
        var reg = x[0] || {}, sales = x[1] || { rows: [], files: [] };
        var home = sales.files.filter(function (f) { return f.fips === co.fips; })[0] || sales.files[0];
        var noSales = miss('We do not hold ' + esc(co.st) + ' transfer records yet. ' + esc(((reg.salesNote || {})[co.abbr]) || 'Sales are public at the county recorder.'));
        // comps: market sales, last 5 years, within 25 miles, newest first
        if (sales.rows.length) {
          var since = new Date(); since.setFullYear(since.getFullYear() - 5);
          var list = F.filterComps(sales.rows, { since: since.toISOString().slice(0, 10), maxMi: 25, minAc: 10, sort: 'date', dir: 'desc' }, c);
          var med = F.medianPpa(list);
          set('frp-comps', (med ? '<p><span class="fl-big">' + F.fmtMoney(med.ppa) + '/ac</span> middle of ' + med.n + ' market sales of 10 acres or more within 25 miles, last 5 years.</p>' : miss('Fewer than 3 market sales of 10 acres or more within 25 miles in the last 5 years; no middle price shown.')) +
            F.compsTable(list, 20) + miss(esc(home.source) + '. Price covers the whole sale, buildings included unless the class is bare land. Miles run to the center of the town where the sale was filed. Sales on several parcels whose acres are uncertain are left out.'));
          if (med) drawSum([['County', co.name + ', ' + co.abbr], ['Nearby sales, middle $/ac', F.fmtMoney(med.ppa)]]);
        } else set('frp-comps', noSales);

        var svcs = F.servicesFor(reg, co.abbr, co.fips);
        var links = ((reg.links || {})[co.abbr] || []).concat((reg.countyLinks || {})[co.fips] || []);
        if (!svcs.length) {
          var e = F.parcelEmpty(co.st, co.name, links);
          set('frp-parcel', '<div class="fl-empty"><b>' + esc(e.title) + '</b><p class="fl-note">' + esc(e.body) + '</p>' + (links.length ? '<p class="fl-note fl-links">' + links.map(function (l) { return '<a href="' + esc(l.url) + '">' + esc(l.t) + '</a>'; }).join(' &middot; ') + '</p>' : '') + '</div>');
          set('frp-hist', sales.rows.length ? miss('Without a parcel number for this field we cannot pick its transfers out of the county record.') : noSales);
          return;
        }
        (function tryNext(i) {
          if (i >= svcs.length) { set('frp-parcel', miss(esc(svcs[0].name) + ' did not answer. Reload in a minute.')); set('frp-hist', ''); return; }
          F.queryParcels(svcs[i], pts).then(function (ps) {
            ps = F.shareInParcels(pts, ps).slice(0, 12);
            if (!ps.length) { set('frp-parcel', miss('No parcel came back for this outline from ' + esc(svcs[i].name) + '.')); set('frp-hist', ''); return; }
            F.serviceDate(svcs[i]).then(function (d) {
              set('frp-parcel', (ps.length > 1 ? miss(ps.length + ' parcels lie under this field, largest share first.') : '') + ps.map(function (p) { return '<div class="fl-p">' + F.parcelHTML(p, d) + '</div>'; }).join(''));
            });
            if (!sales.files.length) { set('frp-hist', noSales); return; }
            var rows = sales.rows.filter(function (r) { return r.county === home.county; });
            set('frp-hist', ps.map(function (p, k) {
              var m = F.matchTransfers(p, rows);
              return (ps.length > 1 ? '<h3 style="font-size:.95rem;margin:.8rem 0 .2rem">Parcel ' + esc(p.id || k + 1) + '</h3>' : '') +
                F.historyHTML(m, F.covOf(home));
            }).join(''));
          }, function () { tryNext(i + 1); });
        })(0);
      });
    });

    // soils (USDA SSURGO through the Field Scout worker, the same read the map page makes)
    var ring = pts.map(function (p) { return p.lng.toFixed(6) + ' ' + p.lat.toFixed(6); }); ring.push(ring[0]);
    fetch(FS_WORKER + '/soil', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wkt: 'POLYGON((' + ring.join(',') + '))' }) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var rows = d && d.Table;
        if (!rows || !rows.length) { set('frp-soil', miss('No soil survey is published for this spot.')); return; }
        var cl = rows.map(function (r) { return { name: r[2] || r[1], ac: parseFloat(r[3]) || 0, nicc: parseInt(r[4], 10) || null, nccpi: r[6] == null || r[6] === '' ? null : parseFloat(r[6]), csr2: d.ext && r[10] != null && r[10] !== '' ? parseFloat(r[10]) : null }; });
        var tot = cl.reduce(function (a, x) { return a + x.ac; }, 0);
        function wavg(k) { var s = 0, a = 0; cl.forEach(function (x) { if (x[k] != null && x.ac > 0) { s += x[k] * x.ac; a += x.ac; } }); return a > 0 && a >= 0.5 * tot ? s / a : null; }
        var np = wavg('nccpi'), cs = wavg('csr2');
        set('frp-soil', '<table class="fl-tbl" style="min-width:0"><thead><tr><th>Soil</th><th class="n">Acres</th><th class="n">Share</th><th class="n">Class</th></tr></thead><tbody>' +
          cl.slice().sort(function (a, b) { return b.ac - a.ac; }).slice(0, 8).map(function (x) { return '<tr><td style="white-space:normal">' + esc(x.name) + '</td><td class="n">' + (x.ac > 0 ? x.ac.toFixed(1) : '') + '</td><td class="n">' + (tot > 0 && x.ac > 0 ? Math.round(x.ac / tot * 100) + '%' : '') + '</td><td class="n">' + (x.nicc || '') + '</td></tr>'; }).join('') +
          '</tbody></table>' + miss([np != null ? 'Soil productivity ' + Math.round(np * 100) + '/100 (USDA NCCPI ' + np.toFixed(2) + ')' : null, cs != null ? 'CSR2 ' + cs.toFixed(1) : null].filter(Boolean).join(' &middot; ') + (np != null || cs != null ? ', weighted by acres in the outline. ' : '') + 'Class is land capability, 1 best to 8. USDA NRCS soil survey (SSURGO).'));
      }).catch(function () { set('frp-soil', miss('The soil survey did not answer. Reload in a minute.')); });

    fetch(FS_WORKER + '/cdl?lat=' + c.lat.toFixed(5) + '&lon=' + c.lng.toFixed(5) + '&years=10').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var h = d && (d.history && d.history.length ? d.history : d.rotation);
      if (!h || !h.length) { set('frp-rot', miss('USDA crop history did not resolve for this spot.')); return; }
      set('frp-rot', '<div class="frp-rot">' + h.slice(0, 10).map(function (x) { return '<span><b>' + esc(x.year) + '</b> ' + esc(x.crop || ('code ' + x.code)) + '</span>'; }).join('') + '</div>' + miss('At the center of the field, USDA NASS Cropland Data Layer, newest first.'));
    }).catch(function () { set('frp-rot', miss('USDA crop history did not answer.')); });

    F.floodAt(pts).then(function (z) { set('frp-flood', F.floodHTML(z)); }, function () { set('frp-flood', F.floodHTML(null)); });
    F.wetAt(pts).then(function (w) { set('frp-wet', F.wetHTML(w)); }, function () { set('frp-wet', F.wetHTML(null)); });
    F.reliefAt(pts).then(function (r) { set('frp-relief', r ? miss('Ground height ' + r.lo.toLocaleString() + ' to ' + r.hi.toLocaleString() + ' ft across ' + r.n + ' points (' + (r.hi - r.lo) + ' ft of relief), USGS 3DEP.') : miss('USGS ground height did not answer.')); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
