/* Field Scout: what's on and around this field (Oct 18, 2026).
   One collapsed card under the land card. Every value is read from a public
   service in the reader's browser at the moment a field is picked, kept for
   the browser session only, and never stored by AGSIST.

   - Soil productivity: the soil card's own SSURGO read (Soil Data Access,
     through the Field Scout worker), reused so the two cards agree.
   - Flood: FEMA National Flood Hazard Layer (zones + the FIRM panel date).
   - Wetlands: USFWS National Wetlands Inventory.
   - Slope: USGS 3DEP elevation, sampled on a grid (getSamples).
   - Energy: USGS Wind Turbine Database, USGS Large-Scale Solar database,
     power lines and substations from OpenStreetMap (Overpass API). HIFLD Open,
     the old national power line map, closed in 2025.
   - Livestock: state feedlot permit points (Iowa DNR, Minnesota PCA). Counts
     and size class only, never a name.
   - Easements: National Conservation Easement Database. Its public map
     service started asking for a sign-in (land-data.yml layers-discover,
     Oct 18, 2026: "Token Required"), so URLS.nced is empty and the card says
     so instead of reading it. Put a public URL back here when one answers.

   Shares of the field (flood, wetland, easement) come from a point grid laid
   over the field and tested against the agency's own shapes, so they read
   "about". scripts/probe_field_layers.py checks every service from a GitHub
   runner (fields, a test query, the browser header) and saves the answers.
   The top half (FSLayers) is plain functions; test/field-scout-layers.test.mjs
   runs them in node. The bottom half draws the card. */
(function (G) {
  'use strict';
  var L = {};

  var URLS = {
    nfhl: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer',
    nwi: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0',
    dep: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples',
    // eersc.usgs.gov dropped (its certificate had expired on the Oct 18 probe)
    wind: ['https://energy.usgs.gov/api/uswtdb/v1/turbines'],
    solar: ['https://energy.usgs.gov/api/uspvdb/v1/projects'],
    // second Overpass server for when the main one is full (it answered 502 "at capacity" on the Oct 18 probe)
    osm: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'],
    nced: null
  };
  // State livestock permit layers (public). active: the where clause that keeps
  // only sites the state lists as active (both layers carry inactive sites; field
  // names from the Oct 18 probe answers, test/fixtures/field-layers-live/). WI DNR's CAFO map service is not wired yet:
  // the probe looks for it (scripts/probe_field_layers.py, discover).
  var FEEDLOTS = {
    IA: { url: 'https://programs.iowadnr.gov/geospatial/rest/services/OneStop/QueryEnvFacs/MapServer/2', active: "opStatus = 'Active'", by: 'Iowa DNR animal feeding operations', about: 'https://programs.iowadnr.gov/maps/afo/' },
    MN: { url: 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_pca/env_feedlots/FeatureServer/0', active: "status_fdlt = 'active'", by: 'Minnesota PCA registered feedlots', about: 'https://gisdata.mn.gov/dataset/env-feedlots' }
  };
  L.URLS = URLS; L.FEEDLOTS = FEEDLOTS;
  var ABOUT = {
    soil: 'https://sdmdataaccess.sc.egov.usda.gov/',
    flood: 'https://www.fema.gov/flood-maps/national-flood-hazard-layer',
    wet: 'https://www.fws.gov/program/national-wetlands-inventory',
    slope: 'https://www.usgs.gov/3d-elevation-program',
    wind: 'https://energy.usgs.gov/uswtdb/',
    solar: 'https://energy.usgs.gov/uspvdb/',
    grid: 'https://www.openstreetmap.org/copyright',
    ease: 'https://www.conservationeasement.us/'
  };
  L.ABOUT = ABOUT;

  // ── geometry ───────────────────────────────────────────────────────
  // ring: [[lng,lat],...]. Even-odd ray cast; works for holes when all rings are passed.
  function inRing(x, y, ring) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  L.inRing = inRing;
  function inRings(x, y, rings) {
    var c = false;
    for (var k = 0; k < rings.length; k++) if (inRing(x, y, rings[k])) c = !c;
    return c;
  }
  L.inRings = inRings;
  function bbox(ring) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    ring.forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    return b;
  }
  L.bbox = bbox;
  function mPerDeg(lat) { return { x: 111320 * Math.cos(lat * Math.PI / 180), y: 110574 }; }

  // A square grid of points inside the field, at most about `max` of them.
  // Each point stands for the same share of the field.
  L.gridIn = function (ring, max) {
    var b = bbox(ring), m = mPerDeg((b[1] + b[3]) / 2);
    var w = (b[2] - b[0]) * m.x, h = (b[3] - b[1]) * m.y;
    if (!(w > 0 && h > 0)) return [];
    var s = Math.max(5, Math.sqrt(w * h / (max || 400))), pts = [];
    for (var y = s / 2; y < h; y += s) for (var x = s / 2; x < w; x += s) {
      var lng = b[0] + x / m.x, lat = b[1] + y / m.y;
      if (inRing(lng, lat, ring)) pts.push([lng, lat]);
    }
    return pts;
  };
  // share (0..1) of the grid points that fall inside any shape that passes keep(attributes)
  L.shareIn = function (pts, feats, keep) {
    if (!pts.length) return null;
    var use = (feats || []).filter(function (f) { return f && f.geometry && f.geometry.rings && (!keep || keep(f.attributes || {})); });
    if (!use.length) return 0;
    var n = 0;
    pts.forEach(function (p) { for (var i = 0; i < use.length; i++) if (inRings(p[0], p[1], use[i].geometry.rings)) { n++; return; } });
    return n / pts.length;
  };

  L.miles = function (lat1, lng1, lat2, lng2) {
    var R = 3958.8, p = Math.PI / 180;
    var a = Math.sin((lat2 - lat1) * p / 2) * Math.sin((lat2 - lat1) * p / 2) + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin((lng2 - lng1) * p / 2) * Math.sin((lng2 - lng1) * p / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  };
  // miles from point c to the segment a-b (flat projection at c; fine at a few miles)
  L.segMiles = function (c, a, b) {
    var m = mPerDeg(c.lat);
    var ax = (a.lng - c.lng) * m.x, ay = (a.lat - c.lat) * m.y, bx = (b.lng - c.lng) * m.x, by = (b.lat - c.lat) * m.y;
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    var px = ax + t * dx, py = ay + t * dy;
    return Math.sqrt(px * px + py * py) / 1609.344;
  };
  L.boxAround = function (c, mi) {
    var dy = mi / 69.0, dx = mi / (69.17 * Math.cos(c.lat * Math.PI / 180));
    return { w: c.lng - dx, e: c.lng + dx, s: c.lat - dy, n: c.lat + dy };
  };

  // ── soil (rows the soil card already parsed into FIELD.soil.classes) ──
  L.soilSummary = function (soil) {
    if (!soil || !soil.classes || !soil.classes.length) return null;
    var cls = soil.classes.filter(function (x) { return x.ac > 0; });
    var tot = cls.reduce(function (a, x) { return a + x.ac; }, 0);
    if (!(tot > 0)) return null;
    function wavg(k, minShare) {
      var a = 0, s = 0; cls.forEach(function (x) { if (x[k] != null && isFinite(x[k])) { a += x.ac; s += x[k] * x.ac; } });
      return a > 0 && a >= (minShare || 0.5) * tot ? s / a : null;
    }
    var byClass = {};
    cls.forEach(function (x) { if (x.nicc) byClass[x.nicc] = (byClass[x.nicc] || 0) + x.ac; });
    var top = null; Object.keys(byClass).forEach(function (k) { if (top == null || byClass[k] > byClass[top]) top = k; });
    var known = Object.keys(byClass).reduce(function (a, k) { return a + byClass[k]; }, 0);
    var good = (byClass[1] || 0) + (byClass[2] || 0);
    var hyd = wavg('hydric', 0.5);
    var r3 = function (v) { return v == null ? null : Math.round(v * 100) / 100; };
    return {
      acres: tot,
      nccpiCorn: r3(wavg('nccpiCorn')), nccpiSoy: r3(wavg('nccpiSoy')), nccpi: r3(wavg('nccpi')),
      csr2: (function () { var v = wavg('csr2'); return v == null ? null : Math.round(v); })(),
      lccTop: top == null ? null : +top, lccTopPct: top == null || !known ? null : Math.round(byClass[top] / known * 100),
      lcc12Pct: known >= 0.5 * tot ? Math.round(good / known * 100) : null,
      hydricPct: hyd == null ? null : Math.round(hyd),
      units: cls.length
    };
  };

  // ── flood (NFHL layer 28 Flood Hazard Zones, layer 3 FIRM Panels) ──
  L.floodSummary = function (feats, pts, panel) {
    if (!feats) return null;
    var sfha = L.shareIn(pts, feats, function (a) { return String(a.SFHA_TF).toUpperCase() === 'T'; });
    var x02 = L.shareIn(pts, feats, function (a) { return String(a.FLD_ZONE).toUpperCase() === 'X' && /0\.2 PCT/i.test(a.ZONE_SUBTY || ''); });
    var way = L.shareIn(pts, feats, function (a) { return /FLOODWAY/i.test(a.ZONE_SUBTY || ''); });
    var zones = {}; feats.forEach(function (f) { var z = f.attributes && f.attributes.FLD_ZONE; if (z) zones[String(z).trim()] = 1; });
    return {
      mapped: feats.length > 0 || !!panel,
      sfhaPct: sfha == null ? null : Math.round(sfha * 100), x02Pct: x02 == null ? null : Math.round(x02 * 100),
      floodwayPct: way == null ? null : Math.round(way * 100),
      zones: Object.keys(zones).sort(),
      panelDate: panel && panel.date || null, panel: panel && panel.id || null
    };
  };
  L.panelOf = function (d) {
    var f = d && d.features && d.features[0]; if (!f) return null;
    var a = f.attributes || {}, t = a.EFF_DATE;
    var date = null;
    if (typeof t === 'number' && isFinite(t)) date = new Date(t).toISOString().slice(0, 10);
    else if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t)) date = t.slice(0, 10);
    return { id: a.FIRM_PAN || null, date: date };
  };

  // ── wetlands (NWI) ─────────────────────────────────────────────────
  L.wetSummary = function (feats, pts, acres) {
    if (!feats) return null;
    var types = {}, total = 0;
    feats.forEach(function (f) { var t = f.attributes && f.attributes.WETLAND_TYPE; if (t) types[t] = types[t] || []; if (t) types[t].push(f); });
    var out = Object.keys(types).map(function (t) {
      var s = L.shareIn(pts, types[t]); return { type: t, ac: s == null ? null : Math.round(s * acres * 10) / 10 };
    }).filter(function (x) { return x.ac == null || x.ac > 0; }).sort(function (a, b) { return (b.ac || 0) - (a.ac || 0); });
    var all = L.shareIn(pts, feats);
    total = all == null ? null : Math.round(all * acres * 10) / 10;
    return { acres: total, pct: all == null ? null : Math.round(all * 100), types: out, touching: feats.length };
  };

  // ── slope (3DEP getSamples on a square grid over the field's box) ──
  L.slopeGrid = function (ring, max) {
    var b = bbox(ring), m = mPerDeg((b[1] + b[3]) / 2);
    var w = (b[2] - b[0]) * m.x, h = (b[3] - b[1]) * m.y;
    var s = Math.max(10, Math.sqrt(w * h / (max || 600)));
    var nx = Math.floor(w / s) + 3, ny = Math.floor(h / s) + 3, pts = [], inside = [];
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var lng = b[0] + (i - 1) * s / m.x, lat = b[1] + (j - 1) * s / m.y;
      pts.push([+lng.toFixed(6), +lat.toFixed(6)]); inside.push(inRing(lng, lat, ring));
    }
    return { pts: pts, inside: inside, nx: nx, ny: ny, s: s };
  };
  // samples: getSamples answer; values in meters, matched back by locationId
  L.slopeStats = function (grid, samples) {
    if (!samples || !samples.length) return null;
    var z = new Array(grid.pts.length);
    samples.forEach(function (sm, k) {
      var id = sm.locationId != null ? sm.locationId : k, v = parseFloat(sm.value);
      if (id >= 0 && id < z.length && isFinite(v) && v > -500 && v < 9000) z[id] = v;
    });
    var nx = grid.nx, s = grid.s, sl = [], lo = Infinity, hi = -Infinity;
    for (var k = 0; k < z.length; k++) {
      if (!grid.inside[k] || z[k] == null) continue;
      lo = Math.min(lo, z[k]); hi = Math.max(hi, z[k]);
      var l = z[k - 1], r = z[k + 1], d = z[k - nx], u = z[k + nx];
      if (k % nx === 0 || k % nx === nx - 1 || l == null || r == null || d == null || u == null) continue;
      var gx = (r - l) / (2 * s), gy = (u - d) / (2 * s);
      sl.push(100 * Math.sqrt(gx * gx + gy * gy));
    }
    if (sl.length < 9) return null;   // too few cells to say anything about slope
    var mean = sl.reduce(function (a, v) { return a + v; }, 0) / sl.length;
    var over = sl.filter(function (v) { return v > 6; }).length / sl.length;
    return { mean: Math.round(mean * 10) / 10, over6Pct: Math.round(over * 100), max: Math.round(Math.max.apply(null, sl) * 10) / 10,
      loFt: Math.round(lo * 3.28084), hiFt: Math.round(hi * 3.28084), n: sl.length, spacingFt: Math.round(s * 3.28084) };
  };

  // ── energy ─────────────────────────────────────────────────────────
  L.windSummary = function (rows, c, mi) {
    if (!Array.isArray(rows)) return null;
    var near = rows.map(function (r) { var la = parseFloat(r.ylat), ln = parseFloat(r.xlong); return isFinite(la) && isFinite(ln) ? { d: L.miles(c.lat, c.lng, la, ln), p: r.p_name, kw: parseFloat(r.t_cap) } : null; })
      .filter(function (x) { return x && x.d <= mi; }).sort(function (a, b) { return a.d - b.d; });
    var proj = {}; near.forEach(function (x) { if (x.p) proj[x.p] = 1; });
    return { n: near.length, nearestMi: near.length ? Math.round(near[0].d * 10) / 10 : null, projects: Object.keys(proj).length, within: mi };
  };
  L.solarSummary = function (rows, c, mi) {
    if (!Array.isArray(rows)) return null;
    var near = rows.map(function (r) { var la = parseFloat(r.ylat), ln = parseFloat(r.xlong); return isFinite(la) && isFinite(ln) ? { d: L.miles(c.lat, c.lng, la, ln), mw: parseFloat(r.p_cap_ac), y: r.p_year } : null; })
      .filter(function (x) { return x && x.d <= mi; }).sort(function (a, b) { return a.d - b.d; });
    var mw = near.reduce(function (a, x) { return a + (isFinite(x.mw) ? x.mw : 0); }, 0);
    return { n: near.length, nearestMi: near.length ? Math.round(near[0].d * 10) / 10 : null, mw: Math.round(mw * 10) / 10, nearestMw: near.length && isFinite(near[0].mw) ? near[0].mw : null, within: mi };
  };
  // highest voltage in an OSM voltage tag ("345000;161000"), in kV; null when not tagged
  L.kv = function (tag) {
    if (!tag) return null;
    var v = String(tag).split(/[;,]/).map(function (x) { return parseFloat(x); }).filter(function (x) { return isFinite(x) && x > 0; });
    if (!v.length) return null;
    var m = Math.max.apply(null, v);
    return m >= 1000 ? Math.round(m / 1000) : Math.round(m);
  };
  L.gridSummary = function (d, c, mi) {
    if (!d || !Array.isArray(d.elements)) return null;
    var line = null, sub = null;
    d.elements.forEach(function (e) {
      var t = e.tags || {};
      if (t.power === 'line' && Array.isArray(e.geometry)) {
        var best = Infinity;
        for (var i = 1; i < e.geometry.length; i++) {
          var a = e.geometry[i - 1], b = e.geometry[i];
          best = Math.min(best, L.segMiles(c, { lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon }));
        }
        if (best <= mi && (!line || best < line.mi)) line = { mi: best, kv: L.kv(t.voltage) };
      } else if (t.power === 'substation') {
        var la = e.lat != null ? e.lat : e.center && e.center.lat, ln = e.lon != null ? e.lon : e.center && e.center.lon;
        if (la == null || ln == null) return;
        var dd = L.miles(c.lat, c.lng, la, ln);
        if (dd <= mi && (!sub || dd < sub.mi)) sub = { mi: dd, kv: L.kv(t.voltage) };
      }
    });
    function r(x) { return x ? { mi: Math.round(x.mi * 10) / 10, kv: x.kv } : null; }
    return { line: r(line), sub: r(sub), within: mi };
  };
  L.overpassQuery = function (c, meters) {
    var a = '(around:' + Math.round(meters) + ',' + c.lat.toFixed(5) + ',' + c.lng.toFixed(5) + ')';
    return '[out:json][timeout:25];way["power"="line"]' + a + ';out tags geom;(node["power"="substation"]' + a + ';way["power"="substation"]' + a + ';);out tags center;';
  };

  // ── livestock ──────────────────────────────────────────────────────
  // The size field, by name or alias. Only animal units get a size class
  // (EPA's thresholds are in animal units); a head count gets none.
  L.capField = function (fields) {
    var best = null;
    (fields || []).forEach(function (f) {
      var n = String(f.name || ''), a = String(f.alias || '');
      if (!/Integer|Double|Single|SmallInteger/i.test(f.type || 'esriFieldTypeInteger')) return;
      if (/^(TOTAL_?)?(ANIMAL_?UNITS?|AUS?|TOT_?AU|AU_?TOTAL|AU_?COUNT|AU_?CAP(ACITY)?)$/i.test(n) || /animal unit/i.test(a)) best = best || { name: n, au: true };
    });
    return best;
  };
  L.feedSummary = function (feats, cap, c, mi) {
    if (!feats) return null;
    var rows = feats.map(function (f) {
      var g = f.geometry || {}; if (!isFinite(g.x) || !isFinite(g.y)) return null;
      var au = cap ? parseFloat((f.attributes || {})[cap.name]) : NaN;
      return { d: L.miles(c.lat, c.lng, g.y, g.x), au: isFinite(au) && au > 0 ? au : null };
    }).filter(function (x) { return x && x.d <= mi; }).sort(function (a, b) { return a.d - b.d; });
    var cls = { small: 0, medium: 0, large: 0, unknown: 0 };
    rows.forEach(function (x) { if (x.au == null) cls.unknown++; else if (x.au >= 1000) cls.large++; else if (x.au >= 300) cls.medium++; else cls.small++; });
    return { n: rows.length, nearestMi: rows.length ? Math.round(rows[0].d * 10) / 10 : null, cls: cls, sized: !!cap, within: mi };
  };

  // ── easements (NCED) ───────────────────────────────────────────────
  function attr(a, k) { for (var key in a) if (key.toLowerCase() === k) return a[key]; return null; }
  L.easeSummary = function (feats, pts, acres) {
    if (!feats) return null;
    var s = L.shareIn(pts, feats);
    var kinds = {};
    feats.forEach(function (f) { var a = f.attributes || {}, t = attr(a, 'eholdtype') || attr(a, 'esmthldr_type') || null; if (t) kinds[String(t).trim()] = 1; });
    return { n: feats.length, acres: s == null ? null : Math.round(s * acres * 10) / 10, holders: Object.keys(kinds).sort() };
  };

  // ── words ──────────────────────────────────────────────────────────
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ''); }
  L.f1 = f1;
  function mi(v) { return v < 0.1 ? 'under 0.1 mi' : f1(v) + ' mi'; }
  L.fmtMi = mi;
  // One plain line per item, built only from numbers that came back.
  L.lines = function (R) {
    var o = {};
    var s = R.soil;
    if (s && (s.nccpiCorn != null || s.lccTop != null)) {
      var v = [];
      if (s.nccpiCorn != null) v.push('NCCPI corn ' + s.nccpiCorn.toFixed(2) + (s.nccpiSoy != null ? ', soy ' + s.nccpiSoy.toFixed(2) : ''));
      if (s.csr2 != null) v.push('CSR2 ' + s.csr2);
      if (s.lccTop != null) v.push('mostly class ' + s.lccTop + (s.lcc12Pct != null ? ' (' + s.lcc12Pct + '% class 1 to 2)' : ''));
      if (s.hydricPct != null) v.push(s.hydricPct + '% hydric');
      o.soil = { v: v.join(' · '), m: 'NCCPI runs 0 to 1 on one national scale, higher grows more dryland corn or beans.' + (s.csr2 != null ? ' CSR2 is the Iowa rating land sales are quoted against.' : '') + ' Class 1 and 2 ground has few limits. Hydric soil formed wet; it is one of the three wetland tests in farm program rules.' };
    }
    var fl = R.flood;
    if (fl) {
      if (!fl.mapped) o.flood = { v: 'No digital FEMA flood map here', m: 'FEMA has not put this spot on its digital map. The paper map at the county may still apply.' };
      else if (fl.sfhaPct == null) o.flood = null;
      else o.flood = { v: (fl.sfhaPct ? 'About ' + fl.sfhaPct + '% in the 1% flood zone' : 'None in the 1% flood zone') + (fl.x02Pct ? ', ' + fl.x02Pct + '% in 0.2% (shaded X)' : '') + (fl.floodwayPct ? ', ' + fl.floodwayPct + '% floodway' : ''),
        m: fl.sfhaPct ? 'Zone A or AE: a 1% chance of a flood any year. A lender will want flood insurance on buildings there.' : 'No part of the field is mapped in the 100-year floodplain.' };
    }
    var w = R.wet;
    if (w) o.wet = w.acres == null ? null : (w.acres > 0 || w.touching ? { v: w.acres > 0 ? 'About ' + f1(w.acres) + ' ac mapped (' + w.types.slice(0, 3).map(function (t) { return t.type.replace(/^Freshwater /, '').toLowerCase(); }).join(', ') + ')' : 'Touches the edge, none inside', m: 'Mapped from aerial photos by USFWS. Not a wetland determination; for farm programs NRCS makes that call.' } : { v: 'None mapped', m: 'No wetland in the National Wetlands Inventory inside the field.' });
    var sl = R.slope;
    if (sl) o.slope = { v: f1(sl.mean) + '% average, ' + (sl.over6Pct ? sl.over6Pct + '% of the field' : 'none of the field') + ' over 6%, ' + (sl.hiFt - sl.loFt) + ' ft of fall (' + sl.loFt.toLocaleString() + ' to ' + sl.hiFt.toLocaleString() + ' ft)',
      m: 'Ground over 6% usually needs residue or contour work to hold soil. Read from USGS elevation every ' + sl.spacingFt + ' ft across the field.' };
    var e = [];
    if (R.wind) e.push(R.wind.n ? R.wind.n + ' wind turbine' + (R.wind.n === 1 ? '' : 's') + ' within ' + R.wind.within + ' mi, nearest ' + mi(R.wind.nearestMi) : 'no wind turbines within ' + R.wind.within + ' mi');
    if (R.solar) e.push(R.solar.n ? R.solar.n + ' large solar site' + (R.solar.n === 1 ? '' : 's') + ' within ' + R.solar.within + ' mi, nearest ' + mi(R.solar.nearestMi) + (R.solar.nearestMw ? ' (' + f1(R.solar.nearestMw) + ' MW)' : '') : 'no large solar within ' + R.solar.within + ' mi');
    if (R.grid) {
      e.push(R.grid.line ? 'power line ' + mi(R.grid.line.mi) + (R.grid.line.kv ? ' (' + R.grid.line.kv + ' kV)' : '') : 'no mapped power line within ' + R.grid.within + ' mi');
      if (R.grid.sub) e.push('substation ' + mi(R.grid.sub.mi));
    }
    if (e.length) o.energy = { v: e.join(' · ').replace(/^./, function (ch) { return ch.toUpperCase(); }), m: 'Turbines and big solar nearby mean developers have been leasing here. A line and substation close by is what a solar or battery buyer looks for first.' };
    var fd = R.feed;
    if (fd) {
      var cl = [];
      if (fd.sized) { if (fd.cls.large) cl.push(fd.cls.large + ' large'); if (fd.cls.medium) cl.push(fd.cls.medium + ' medium'); if (fd.cls.small) cl.push(fd.cls.small + ' small'); if (fd.cls.unknown) cl.push(fd.cls.unknown + ' size not listed'); }
      o.feed = { v: fd.n ? fd.n + ' within ' + fd.within + ' mi, nearest ' + mi(fd.nearestMi) + (cl.length ? ' (' + cl.join(', ') + ')' : '') : 'None within ' + fd.within + ' mi',
        m: 'Active permitted or registered livestock sites on the state list. Manure for sale nearby, and the neighbors a new barn would have.' + (fd.sized ? ' Large is 1,000 animal units and up, medium 300 to 999.' : '') };
    }
    var es = R.ease;
    if (es) o.ease = es.n ? { v: (es.acres ? 'About ' + f1(es.acres) + ' ac under a recorded easement' : 'An easement touches the field edge') + (es.holders.length ? ' (' + es.holders.join(', ').toLowerCase() + ')' : ''), m: 'A conservation easement limits what the ground can be used for, and it stays with the land when it sells. Read the deed.' } :
      { v: 'None recorded', m: 'No easement in the national database touches the field. Many NRCS easements are not in it; the county recorder has the deed.' };
    return o;
  };
  L.summary = function (o) {
    var bits = [];
    function cut(k, re) { if (o[k] && o[k].v) { var m = o[k].v.match(re); if (m) bits.push(m[0]); } }
    cut('soil', /NCCPI corn [0-9.]+|mostly class \d/);
    if (o.flood) bits.push(/^About/.test(o.flood.v) ? o.flood.v.replace(/^About /, '').replace(/,.*$/, '') : /^None/.test(o.flood.v) ? 'no 1% flood zone' : 'no FEMA map');
    if (o.wet) bits.push(/^About/.test(o.wet.v) ? o.wet.v.replace(/^About /, '').replace(/ mapped.*$/, ' wetland') : 'no wetland inside');
    cut('slope', /^[0-9.]+% average/);
    if (o.feed) bits.push(o.feed.v.replace(/, nearest.*$/, '').replace(/^None within/, 'no feedlots within').replace(/^(\d+) within/, '$1 feedlots within'));
    return bits.join(' · ').replace(/% average/, '% slope');
  };

  if (typeof module === 'object' && module.exports) { module.exports = L; return; }
  G.FSLayers = L;

  // ── the card ───────────────────────────────────────────────────────
  var CSS = '.fsl{border:1px solid var(--border);border-radius:8px;background:var(--surface2);margin:.2rem 0 .4rem}' +
    '.fsl>summary{cursor:pointer;list-style:none;padding:.7rem .8rem;display:flex;gap:.6rem;align-items:flex-start}.fsl>summary::-webkit-details-marker{display:none}' +
    '.fsl>summary:before{content:"+";font-family:"JetBrains Mono",monospace;color:var(--gold);font-weight:700;width:1em;flex:none}.fsl[open]>summary:before{content:"\\2212"}' +
    '.fsl-h{font-weight:600;color:var(--text);font-size:.95rem}.fsl-sum{display:block;font-size:.82rem;color:var(--text-dim);margin-top:.15rem;line-height:1.45}' +
    '.fsl-list{margin:0;padding:0 .8rem .6rem;list-style:none}.fsl-i{border-top:1px solid var(--border);padding:.6rem 0}' +
    '.fsl-k{font-family:"JetBrains Mono",monospace;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}' +
    '.fsl-v{color:var(--text);font-size:.92rem;font-weight:600;margin:.15rem 0;overflow-wrap:anywhere}.fsl-v.fsl-off{font-weight:400;color:var(--text-dim)}' +
    '.fsl-m{font-size:.8rem;color:var(--text-dim);line-height:1.5;margin:0}.fsl-s{font-size:.74rem;color:var(--text-muted);margin-top:.2rem}.fsl-s a{color:var(--text-muted)}';
  var ITEMS = [
    ['soil', 'Soil productivity', 'USDA SSURGO (Soil Data Access)'],
    ['flood', 'Flood', 'FEMA National Flood Hazard Layer'],
    ['wet', 'Wetlands', 'USFWS National Wetlands Inventory'],
    ['slope', 'Slope', 'USGS 3DEP elevation'],
    ['energy', 'Energy nearby', 'USGS wind and solar databases; power lines \u00a9 OpenStreetMap contributors'],
    ['feed', 'Livestock sites', ''],
    ['ease', 'Conservation easements', 'National Conservation Easement Database']
  ];

  var CACHE = {};
  function ckey(k) { return 'fsl:' + k; }
  function cached(k, make) {
    if (CACHE[k]) return CACHE[k];
    try { var s = sessionStorage.getItem(ckey(k)); if (s) { CACHE[k] = Promise.resolve(JSON.parse(s)); return CACHE[k]; } } catch (e) {}
    CACHE[k] = make().then(function (v) { try { sessionStorage.setItem(ckey(k), JSON.stringify(v)); } catch (e) {} return v; }, function (e) { delete CACHE[k]; throw e; });
    return CACHE[k];
  }
  function fetchJSON(url, opt, ms) {
    opt = opt || {};
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = null;
    if (ctrl) { opt.signal = ctrl.signal; t = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms || 25000); }
    return fetch(url, opt).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(String(r.status)); return r.json(); }, function (e) { clearTimeout(t); throw e; })
      .then(function (d) { if (d && d.error) throw new Error('service error'); return d; });
  }
  function form(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function post(url, o, ms) { return fetchJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(o) }, ms); }
  function arcPoly(base, ring, fields) {
    return post(base + '/query', { f: 'json', where: '1=1', outFields: fields, returnGeometry: 'true', outSR: '4326', inSR: '4326', geometryPrecision: '6', maxAllowableOffset: '0.00003',
      geometryType: 'esriGeometryPolygon', spatialRel: 'esriSpatialRelIntersects', geometry: JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } }) })
      .then(function (d) { if (!d || !Array.isArray(d.features)) throw new Error('no features'); return d.features; });
  }
  function firstOk(urls, make) {
    return urls.reduce(function (p, u) { return p.catch(function () { return make(u); }); }, Promise.reject(new Error('start')));
  }
  function today() { return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

  G.__fsLayers = function (FSX) {
    if (!document.getElementById('fsl-css')) { var st = document.createElement('style'); st.id = 'fsl-css'; st.textContent = CSS; document.head.appendChild(st); }
    var S = { gen: null };
    function live() { return S.gen === FSX.fieldGen; }
    function mount() {
      var old = document.getElementById('fs-layers-wrap'); if (old) old.parentNode.removeChild(old);
      var html = '<div class="fs-section" id="fs-layers-wrap"><div class="fs-section-h" role="heading" aria-level="3"><span class="ico" aria-hidden="true">' + ((FSX.ICONS && FSX.ICONS.risk) || '') + '</span>On and Around This Field</div>' +
        '<div class="fs-section-body"><details class="fsl" id="fsl"><summary><span><span class="fsl-h">Flood, wetlands, slope, energy, livestock, easements</span><span class="fsl-sum" id="fsl-sum">Reading public maps&hellip;</span></span></summary><ul class="fsl-list">' +
        ITEMS.map(function (it) { return '<li class="fsl-i" id="fsl-' + it[0] + '"><div class="fsl-k">' + it[1] + '</div><div class="fsl-v fsl-off">reading&hellip;</div></li>'; }).join('') + '</ul></details></div></div>';
      var land = document.getElementById('fs-land'), sec = land && land.closest ? land.closest('.fs-section') : null;
      if (sec) sec.insertAdjacentHTML('afterend', html);
      else { var R = document.getElementById('fs-deck') || document.getElementById('fs-results'); if (R) R.insertAdjacentHTML('beforeend', html); }
      try { if (sessionStorage.getItem('fsl-open') === '1') document.getElementById('fsl').open = true; } catch (e) {}
      var d = document.getElementById('fsl'); if (d) d.addEventListener('toggle', function () { try { sessionStorage.setItem('fsl-open', d.open ? '1' : '0'); } catch (e) {} });
    }
    var R = {}, state = {}, src = {}, when = today();
    function paint() {
      if (!live()) return;
      var o = L.lines(R);
      ITEMS.forEach(function (it) {
        var k = it[0], el = document.getElementById('fsl-' + k); if (!el) return;
        var st = state[k], line = o[k], s = src[k] || { t: it[2], u: ABOUT[k] };
        var v, m = '';
        if (st === 'wait' && !line) v = '<div class="fsl-v fsl-off">reading&hellip;</div>';
        else if (line) { v = '<div class="fsl-v">' + FSX.esc(line.v) + '</div>'; m = '<p class="fsl-m">' + FSX.esc(line.m) + '</p>'; }
        else if (st === 'na') v = '<div class="fsl-v fsl-off">' + FSX.esc(s.na || 'No public layer for this state yet.') + '</div>';
        else if (st === 'fail') v = '<div class="fsl-v fsl-off">The service didn&rsquo;t answer. Tap the field again in a few minutes.</div>';
        else v = '<div class="fsl-v fsl-off">Not enough came back to say. Left blank rather than guessed.</div>';
        var srcl = s.t ? '<div class="fsl-s">' + (s.u ? '<a href="' + s.u + '" target="_blank" rel="noopener">' + FSX.esc(s.t) + '</a>' : FSX.esc(s.t)) + ' &middot; read ' + when + (s.asof ? ' &middot; ' + FSX.esc(s.asof) : '') + '</div>' : '';
        el.innerHTML = '<div class="fsl-k">' + it[1] + '</div>' + v + m + srcl;
      });
      var sum = document.getElementById('fsl-sum'), line = L.summary(o);
      var waiting = ITEMS.some(function (it) { return state[it[0]] === 'wait'; });
      if (sum) sum.textContent = line ? line + (waiting ? ' · still reading' : '') : (waiting ? 'Reading public maps…' : 'The public maps did not answer for this field.');
    }
    function job(k, p, apply) {
      state[k] = 'wait';
      p.then(function (v) { if (!live()) return; apply(v); state[k] = 'done'; paint(); }, function () { if (!live()) return; state[k] = 'fail'; paint(); });
    }
    function waitFor(get, ms) {
      return new Promise(function (ok) {
        var t0 = Date.now();
        (function tick() { var v = get(); if (v || Date.now() - t0 > ms || !live()) return ok(v || null); setTimeout(tick, 400); })();
      });
    }
    function run(poly) {
      S.gen = FSX.fieldGen; R = {}; state = {}; src = {}; when = today();
      mount();
      var ll = FSX.latlngs(poly), ring = ll.map(function (p) { return [+p.lng.toFixed(6), +p.lat.toFixed(6)]; });
      ring.push(ring[0]);
      var c = FSX.polyCentroid(poly), acres = FSX.polyAcres(poly), key = ring.map(function (p) { return p.join(','); }).join(';');
      var pts = L.gridIn(ring, 400);
      paint();

      // 1. soil: the soil card's read (same worker answer), so the cards agree
      job('soil', waitFor(function () { return FSX.FIELD && FSX.FIELD.soil; }, 45000).then(function (s) { if (!s) throw new Error('no soil'); return L.soilSummary(s); }),
        function (v) { R.soil = v; });

      // 2. flood + the FIRM panel date at the field center
      job('flood', cached('flood:' + key, function () {
        var panel = post(URLS.nfhl + '/3/query', { f: 'json', where: '1=1', outFields: 'FIRM_PAN,EFF_DATE', returnGeometry: 'false', geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', geometry: c.lng.toFixed(6) + ',' + c.lat.toFixed(6) })
          .then(L.panelOf, function () { return null; });
        return Promise.all([arcPoly(URLS.nfhl + '/28', ring, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF'), panel]).then(function (a) { return L.floodSummary(a[0], pts, a[1]); });
      }), function (v) { R.flood = v; if (v && v.panelDate) src.flood = { t: ITEMS[1][2], u: ABOUT.flood, asof: 'FIRM panel effective ' + v.panelDate }; });

      // 3. wetlands
      job('wet', cached('wet:' + key, function () { return arcPoly(URLS.nwi, ring, 'WETLAND_TYPE,ATTRIBUTE').then(function (f) { return L.wetSummary(f, pts, acres); }); }), function (v) { R.wet = v; });

      // 4. slope
      job('slope', cached('slope:' + key, function () {
        var g = L.slopeGrid(ring, 600);
        return post(URLS.dep, { f: 'json', geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', interpolation: 'RSP_BilinearInterpolation',
          geometry: JSON.stringify({ points: g.pts, spatialReference: { wkid: 4326 } }) }, 30000).then(function (d) { return L.slopeStats(g, d && d.samples); });
      }), function (v) { R.slope = v; });

      // 5. energy: three reads, one line
      var ck = c.lat.toFixed(3) + ',' + c.lng.toFixed(3), parts = 0, fails = 0;
      state.energy = 'wait';
      function eDone(ok) { parts++; if (!ok) fails++; if (parts === 3) state.energy = fails === 3 ? 'fail' : 'done'; paint(); }
      function rest(base, box, sel) { return base + '?xlong=gte.' + box.w.toFixed(4) + '&xlong=lte.' + box.e.toFixed(4) + '&ylat=gte.' + box.s.toFixed(4) + '&ylat=lte.' + box.n.toFixed(4) + '&select=' + sel; }
      cached('wind:' + ck, function () { var b = L.boxAround(c, 5); return firstOk(URLS.wind, function (u) { return fetchJSON(rest(u, b, 'case_id,p_name,t_cap,xlong,ylat')); }).then(function (rows) { return L.windSummary(rows, c, 5); }); })
        .then(function (v) { if (!live()) return; R.wind = v; eDone(!!v); }, function () { if (live()) eDone(false); });
      cached('solar:' + ck, function () { var b = L.boxAround(c, 10); return firstOk(URLS.solar, function (u) { return fetchJSON(rest(u, b, 'case_id,p_year,p_cap_ac,xlong,ylat')); }).then(function (rows) { return L.solarSummary(rows, c, 10); }); })
        .then(function (v) { if (!live()) return; R.solar = v; eDone(!!v); }, function () { if (live()) eDone(false); });
      cached('grid:' + ck, function () { return firstOk(URLS.osm, function (u) { return post(u, { data: L.overpassQuery(c, 5 * 1609.344) }, 30000); }).then(function (d) { return L.gridSummary(d, c, 5); }); })
        .then(function (v) { if (!live()) return; R.grid = v; eDone(!!v); }, function () { if (live()) eDone(false); });

      // 6. livestock: the state's own permit layer, once we know the state
      var stP = waitFor(function () { return FSX.FIELD && FSX.FIELD.county && FSX.FIELD.county.abbr; }, 15000);
      state.feed = 'wait';
      stP.then(function (st) {
        if (!live()) return;
        var F = st && FEEDLOTS[st];
        if (!F) { state.feed = 'na'; src.feed = { t: '', na: st === 'WI' ? 'Wisconsin DNR’s CAFO map is not wired in yet.' : 'No public feedlot layer for ' + (st || 'this state') + ' yet.' }; paint(); return; }
        src.feed = { t: F.by, u: F.about };
        job('feed', cached('feed:' + st + ':' + ck, function () {
          return fetchJSON(F.url + '?f=json').then(function (meta) {
            var cap = L.capField(meta && meta.fields), oid = (meta && meta.objectIdField) || 'OBJECTID';
            return post(F.url + '/query', { f: 'json', where: F.active || '1=1', outFields: oid + (cap ? ',' + cap.name : ''), returnGeometry: 'true', outSR: '4326', inSR: '4326',
              geometryType: 'esriGeometryPoint', spatialRel: 'esriSpatialRelIntersects', geometry: c.lng.toFixed(6) + ',' + c.lat.toFixed(6), distance: '3', units: 'esriSRUnit_StatuteMile' })
              .then(function (d) { if (!d || !Array.isArray(d.features)) throw new Error('no features'); return L.feedSummary(d.features, cap, c, 3); });
          });
        }), function (v) { R.feed = v; });
      });

      // 7. easements
      if (!URLS.nced) { state.ease = 'na'; src.ease = { t: 'National Conservation Easement Database', u: ABOUT.ease, na: 'The national easement map now needs a sign-in, so it is not read here. Any easement is on the deed at the county recorder.' }; }
      else job('ease', cached('ease:' + key, function () { return arcPoly(URLS.nced, ring, '*').then(function (f) { return L.easeSummary(f, pts, acres); }); }), function (v) { R.ease = v; });
      paint();
    }
    function clear() { S.gen = null; }
    return { run: run, clear: clear, results: function () { return R; } };
  };
})(typeof window !== 'undefined' ? window : globalThis);
