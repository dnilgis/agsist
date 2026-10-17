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
     own public transfer return data by scripts/fetch_wi_transfers.py.
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
  FSLand.rowObjs = function (file) {
    if (!file || !file.cols || !file.rows) return [];
    var ix = {}; file.cols.forEach(function (c, i) { ix[c] = i; });
    var munis = file.munis || {};
    return file.rows.map(function (a) {
      var o = {}; file.cols.forEach(function (c, i) { o[c] = a[i]; });
      var m = munis[o.muni];
      if (m) { o.muniName = m[0]; o.lat = m[1]; o.lng = m[2]; }
      else o.muniName = o.muni;
      o.ppa = FSLand.perAcre(o.price, o.acres);
      o.county = file.county;
      return o;
    });
  };

  // Wisconsin property classes (the assessment classes printed on the tax bill).
  var CLASS = { '1': 'Residential', '2': 'Commercial', '3': 'Manufacturing', '4': 'Agricultural', '5': 'Undeveloped',
    '5M': 'Agricultural forest', '6': 'Productive forest', '7': 'Other (farm buildings and farm home)', 'X': 'Exempt' };
  FSLand.classLabel = function (c) {
    return String(c || '').split(/[\s,;/]+/).filter(Boolean).map(function (x) { return CLASS[x.toUpperCase()] || x; }).join(', ');
  };
  FSLand.FARM_CLASSES = ['4', '5', '5M', '6', '7'];
  FSLand.hasBuildings = function (c) { return /(^|[\s,;/])(1|2|3|7)($|[\s,;/])/.test(String(c || '')); };

  // A sale counts as a comp only when it reads like a market sale: a price, acres,
  // and a deed type that normally carries one. Quit claims, gifts and the transfers
  // the return marks exempt from the fee are left out by default.
  FSLand.marketSale = function (r) {
    if (!r || !(num(r.price) > 0) || !(num(r.acres) > 0)) return false;
    if (r.exempt) return false;
    var c = String(r.conv || '').toUpperCase();
    if (/QUIT|GIFT|CORRECT|TERMINAT|TRANSFER ON DEATH|TOD|SHERIFF|FORECLOS|EASEMENT|LEASE/.test(c)) return false;
    return true;
  };

  // Filters for the comps list. f = { minAc, maxAc, minPpa, maxPpa, since (YYYY-MM-DD),
  // cls: ['4',...] (any match), maxMi, all (include non-market deeds), sort, dir }
  FSLand.filterComps = function (rows, f, origin) {
    f = f || {};
    var out = (rows || []).filter(function (r) {
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
    function n1(k) { var v = one(k); var x = num(v); return x; }
    var ids = (pick('pid') || []).concat(pick('pid2') || []);
    var owner = pick('owner');
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
    if (p.land === 0 && p.imp === 0 && !p.total) { p.land = null; p.imp = null; }   // blank rolls write zeros
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
    if (sw) sw.forEach(function (s) { if (s.verified || s.builtin) out.push(s); });
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

  if (typeof module === 'object' && module.exports) { module.exports = FSLand; return; }
  G.FSLand = FSLand;

  // ════════════════════════════════════════════════════════════════════
  // The card. Everything below runs in the browser only.
  // ════════════════════════════════════════════════════════════════════
  var REG_URL = '/data/land/parcel-services.json';
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var fm = FSLand.fmtMoney, fd = FSLand.fmtDate;

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
    '.fl-filt{display:grid;grid-template-columns:1fr 1fr;gap:.4rem .6rem;margin:.4rem 0;font-size:.8rem;color:var(--text-muted)}.fl-filt label{display:flex;flex-direction:column;gap:.15rem}' +
    '.fl-filt input,.fl-filt select{font:inherit;font-size:.85rem;padding:.3rem .4rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);min-width:0}' +
    '.fl-tblw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:.3rem 0}.fl-tbl{width:100%;border-collapse:collapse;font-size:.82rem;min-width:420px}' +
    '.fl-tbl th{text-align:left;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);padding:.3rem .4rem;white-space:nowrap}' +
    '.fl-tbl th button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}.fl-tbl td{padding:.3rem .4rem;border-bottom:1px solid var(--border);color:var(--text);white-space:nowrap}' +
    '.fl-tbl td.n,.fl-tbl th.n{text-align:right;font-family:var(--font-mono)}' +
    '.fl-big{font-family:var(--font-mono);font-size:1.3rem;font-weight:700;color:var(--text)}' +
    '.fl-links a{color:var(--gold)}.fl-empty{border:1px dashed var(--border);border-radius:8px;padding:.7rem .8rem;margin:.5rem 0}.fl-empty b{color:var(--text)}' +
    '.fl-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.35rem 0}.fl-chip{font-size:.8rem;border:1px solid var(--border);border-radius:999px;padding:.15rem .55rem;color:var(--text)}';
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
  FSLand.historyHTML = function (matches, cov, opts) {
    opts = opts || {};
    var names = cov && cov.names;
    var span = cov && cov.from ? 'Electronic transfer returns in our copy run from ' + fd(cov.from) + ' to ' + fd(cov.to) + '.' : '';
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
  FSLand.compsTable = function (list, max) {
    max = max || 40;
    if (!list.length) return '<p class="fl-note">No sales match these filters.</p>';
    function th(k, t, n) { return '<th class="' + (n ? 'n' : '') + '"><button type="button" data-sort="' + k + '">' + t + '</button></th>'; }
    return '<div class="fl-tblw"><table class="fl-tbl"><thead><tr>' + th('date', 'Date') + th('ppa', '$/ac', 1) + th('acres', 'Acres', 1) + th('price', 'Price', 1) + th('mi', 'Miles', 1) + '<th>Town, class</th></tr></thead><tbody>' +
      list.slice(0, max).map(function (r) {
        return '<tr><td>' + fd(r.date) + '</td><td class="n">' + (r.ppa != null ? fm(r.ppa) : '') + '</td><td class="n">' + (+r.acres).toFixed(1) + '</td><td class="n">' + fm(r.price) + '</td><td class="n">' + (r.mi != null ? r.mi.toFixed(0) : '') + '</td><td>' + esc(r.muniName || '') + (r.cls ? ', ' + esc(FSLand.classLabel(r.cls)) : '') + (FSLand.hasBuildings(r.cls) ? ' <span class="fl-warn">buildings</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (list.length > max ? '<p class="fl-note">Showing ' + max + ' of ' + list.length + '. Narrow the filters to see the rest.</p>' : '');
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
        '<h4 style="margin:.7rem 0 .2rem">Every recorded transfer of this parcel</h4><div id="fl-hist"><div class="fs-loading"><span class="fs-spin"></span>reading</div></div>');
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
      set('fl-hist', FSLand.historyHTML(m, { from: home.coverage && home.coverage.from, to: home.coverage && home.coverage.to, names: !!home.names, county: home.county, src: home.source_short, links: home.links }));
    }
    function renderComps() {
      if (!S.sales || !S.sales.rows.length) return;
      var f = S.f, list = FSLand.filterComps(S.sales.rows, f, S.c), med = FSLand.medianPpa(list);
      FSX.FIELD.land = FSX.FIELD.land || {}; FSX.FIELD.land.comps = { list: list.slice(0, 25), med: med, f: JSON.parse(JSON.stringify(f)) };
      set('fl-clist', (med ? '<p><span class="fl-big">' + fm(med.ppa) + '/ac</span> <span class="fl-note">middle of ' + med.n + ' sales below</span></p>' : '<p class="fl-note">Fewer than 3 sales match; no middle price shown.</p>') + FSLand.compsTable(list));
      var b = document.getElementById('fl-clist');
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
        '<p class="fl-note">' + esc(f.source || 'State transfer returns') + ', ' + (cov.from ? fd(cov.from) + ' to ' + fd(cov.to) : '') + '. Price is what the return lists for the whole sale, buildings included unless the class is bare land. Miles run from your field to the center of the town where the sale was filed, not to the parcel. Market sales leave out quit claims, gifts and fee-exempt transfers.</p>';
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
      S.gen = FSX.fieldGen; S.sel = 0; S.parcels = []; S.sales = null;
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
    function clear() { if (S.lines && FSX.map) { FSX.map.removeLayer(S.lines); S.lines = null; } S.gen = null; }
    return { run: run, clear: clear, toggleLayer: toggleLayer };
  };
})(typeof window !== 'undefined' ? window : globalThis);
