/* AGSIST place profile (Oct 18, 2026): the numbers behind /here.
   Pure functions, no fetching, no DOM. Works in node (require) and in the
   browser (window.AgPlace). components/here.js does the fetching and drawing.

   Inputs are files already on the site:
     data/atlas/pct/<ST>.json      the state's counties and their ranked figures (scripts/build_place_pct.py)
     data/layers.json              the layer registry (source names and links), read through components/layers.js
     data/rain/<st>.json, data/drought/county-week.json, data/hail/recent.json,
     data/transport/basis.json, data/basis-states.json, /usda-calendar.ics, a bids snapshot

   Rules (Sig's honest numbers): every figure carries its source and year; a
   figure that is missing stays missing with its reason; ranks are "among
   <State> counties", never among fields; the one sentence is a fixed template
   filled from the numbers, nothing written freehand.

   test/place.test.mjs runs every function here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgPlace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_RANK_N = 5;          // fewer counties than this with a figure: no rank
  var BAND = 0.1;              // top or bottom tenth of the state stands out
  var HAIL_MILES = 25;
  var BID_MILES = 50;

  var STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  var FIPS_ST = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY' };

  /* ── roles ────────────────────────────────────────────────────── */
  // Each role reorders the sections and adds one button to the matching tool.
  var SECTIONS = ['week', 'fingerprint', 'unusual', 'long'];
  var ROLES = [
    { id: 'farmer', label: 'Farmer', order: ['week', 'fingerprint', 'unusual', 'long'], tool: 'bids' },
    { id: 'landowner', label: 'Landowner', order: ['fingerprint', 'unusual', 'long', 'week'], tool: 'sheet' },
    { id: 'buyer', label: 'Buyer or Seller', order: ['fingerprint', 'long', 'unusual', 'week'], tool: 'scout' },
    { id: 'lender', label: 'Lender or Appraiser', order: ['fingerprint', 'long', 'unusual', 'week'], tool: 'comps' },
    { id: 'adjuster', label: 'Adjuster', order: ['week', 'long', 'fingerprint', 'unusual'], tool: 'hail' },
    { id: 'hauler', label: 'Hauler', order: ['week', 'fingerprint', 'unusual', 'long'], tool: 'bids' },
    { id: 'elevator', label: 'Elevator or Plant', order: ['week', 'fingerprint', 'long', 'unusual'], tool: 'basis' },
    { id: 'analyst', label: 'Analyst', order: ['fingerprint', 'unusual', 'long', 'week'], tool: 'data' },
    { id: 'agency', label: 'Agency', order: ['fingerprint', 'long', 'unusual', 'week'], tool: 'sheet' },
    { id: 'media', label: 'Media', order: ['unusual', 'fingerprint', 'long', 'week'], tool: 'atlas' }
  ];
  var ROLE_BY = {};
  ROLES.forEach(function (r) { ROLE_BY[r.id] = r; });
  function role(id) { return ROLE_BY[String(id || '').toLowerCase()] || null; }
  function order(id) { var r = role(id); return r ? r.order.slice() : SECTIONS.slice(); }

  function stSlug(st) { return String(STATES[st] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

  /* The one tool button for a role. place: { fips, st, slug, flags, lat, lng, zip, point }. */
  function tool(id, place) {
    var r = role(id);
    if (!r || !place) return null;
    var ll = place.lat != null && place.lng != null ? (+place.lat).toFixed(4) + ',' + (+place.lng).toFixed(4) : '';
    switch (r.tool) {
      case 'bids':
        return place.zip ? { href: '/cash-bids?zip=' + place.zip, text: 'Cash bids near ' + place.zip }
          : { href: '/cash-bids/' + stSlug(place.st) + '/', text: 'Cash bids across ' + STATES[place.st] };
      case 'basis':
        return { href: '/cash-bids/' + stSlug(place.st) + '/#basis', text: 'Basis at ' + STATES[place.st] + ' elevators' };
      case 'scout':
        return ll ? { href: '/field-scout?at=' + ll + '&fips=' + place.fips, text: 'Open this spot in Field Scout' } : null;
      case 'comps':
        return ll ? { href: '/comp-report?lat=' + (+place.lat).toFixed(4) + '&lon=' + (+place.lng).toFixed(4) + (place.point ? '' : '&at=town') + '&fips=' + place.fips, text: 'Comparable sales report' } : null;
      case 'hail':
        return ll ? { href: '/hail-map?lat=' + (+place.lat).toFixed(4) + '&lon=' + (+place.lng).toFixed(4), text: 'Hail report for this spot (adjuster sheet)' } : null;
      case 'sheet':
        return { href: '/farmland-atlas/sheet#' + place.fips, text: 'Printable county sheet' };
      case 'atlas':
        return place.flags && place.flags.indexOf('a') >= 0 ? { href: '/farmland-atlas/' + stSlug(place.st) + '/' + place.slug, text: 'Farmland Atlas county page' }
          : { href: '/farmland-atlas', text: 'Farmland Atlas' };
      case 'data':
        return { href: '/developer', text: 'Data files and embeds' };
    }
    return null;
  }

  /* ── the query ────────────────────────────────────────────────── */
  function num(x) { var n = typeof x === 'number' ? x : (x == null || x === '' ? NaN : Number(x)); return isFinite(n) ? n : null; }
  function parseQuery(search) {
    var out = { q: '', fips: null, zip: null, at: null, role: null };
    var s = String(search || '').replace(/^\?/, '');
    s.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' ')), v = '';
      try { v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { v = ''; }
      v = v.trim();
      if (k === 'q') out.q = v.slice(0, 80);
      else if (k === 'fips' && /^\d{5}$/.test(v) && FIPS_ST[v.slice(0, 2)]) out.fips = v;
      else if (k === 'zip' && /^\d{5}$/.test(v)) out.zip = v;
      else if (k === 'at') out.at = parsePoint(v);
      else if (k === 'for' && role(v)) out.role = v.toLowerCase();
    });
    return out;
  }
  function parsePoint(v) {
    var m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(v || ''));
    if (!m) return null;
    var lat = +m[1], lng = +m[2];
    if (lng > 0 && lng <= 180) lng = -lng;            // a US longitude typed without its minus sign
    if (lat < 17 || lat > 72 || lng < -180 || lng > -64) return null;
    return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
  }

  /* What the box was given: { kind: 'zip'|'point'|'county'|'town'|'fips'|'empty', ... } */
  function classify(text) {
    var q = String(text || '').trim();
    if (!q) return { kind: 'empty' };
    if (/^\d{5}$/.test(q)) return { kind: 'zip', zip: q };
    var p = parsePoint(q);
    if (p) return { kind: 'point', at: p };
    var sp = splitState(q);
    if (/\b(county|parish|borough|census area|co\.?)$/i.test(sp.name)) return { kind: 'county', name: sp.name.replace(/\bco\.?$/i, 'County'), st: sp.st };
    return { kind: 'town', name: sp.name, st: sp.st };
  }
  var NAME_ST = {};
  Object.keys(STATES).forEach(function (k) { NAME_ST[STATES[k].toLowerCase()] = k; });
  /* "Champaign County, IL" / "Chetek wi" / "Great Bend, Kansas" -> { name, st } */
  function splitState(q) {
    var s = String(q || '').trim().replace(/\s+/g, ' ');
    var m = /^(.*?)[,\s]+([A-Za-z]{2})\.?$/.exec(s);
    if (m && STATES[m[2].toUpperCase()] && m[1].trim()) return { name: m[1].replace(/,\s*$/, '').trim(), st: m[2].toUpperCase() };
    var low = s.toLowerCase();
    var names = Object.keys(NAME_ST).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (low.length > n.length && low.slice(-n.length) === n && /[,\s]/.test(low.charAt(low.length - n.length - 1))) {
        return { name: s.slice(0, s.length - n.length).replace(/[,\s]+$/, '').trim(), st: NAME_ST[n] };
      }
    }
    return { name: s, st: null };
  }
  function normName(s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s.replace(/\bsaint\b/g, 'st').replace(/['’.]/g, '').replace(/&/g, ' and ')
      .replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function stateFromName(n) {
    if (!n) return null;
    var s = String(n).trim();
    if (STATES[s.toUpperCase()]) return s.toUpperCase();
    return NAME_ST[s.toLowerCase()] || null;
  }
  /* County names to FIPS, from data/atlas/pct/index.json ({fips: [name, st]}).
     Returns every match (a name found in more than one state comes back as more than one). */
  function findCounty(index, name, st) {
    var want = normName(name), out = [];
    var c = index && (index.counties || index);
    if (!c || !want) return out;
    Object.keys(c).forEach(function (f) {
      var row = c[f];
      if (st && row[1] !== st) return;
      if (normName(row[0]) === want) out.push({ fips: f, name: row[0], st: row[1] });
    });
    // "Richmond" when both Richmond city and Richmond County exist: prefer the county
    if (out.length > 1 && st) {
      var cty = out.filter(function (r) { return /County|Parish|Borough/.test(r.name); });
      if (cty.length === 1) return cty;
    }
    return out;
  }
  /* A geocoder row (Open-Meteo: admin1 state name, admin2 county name) to a county in a pct file. */
  function countyInState(pct, countyName) {
    if (!pct || !pct.counties || !countyName) return null;
    var want = normName(countyName), hit = null;
    Object.keys(pct.counties).forEach(function (f) { if (!hit && normName(pct.counties[f].n) === want) hit = f; });
    return hit;
  }
  /* Point in county, on data/atlas/counties.geo.json features. */
  function inRing(ring, x, y) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function countyAt(geo, lat, lng) {
    if (!geo || !geo.features) return null;
    for (var i = 0; i < geo.features.length; i++) {
      var f = geo.features[i], g = f.geometry;
      if (!g) continue;
      var polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      for (var p = 0; p < polys.length; p++) {
        if (inRing(polys[p][0], lng, lat)) {
          var hole = false;
          for (var h = 1; h < polys[p].length; h++) if (inRing(polys[p][h], lng, lat)) hole = true;
          if (!hole) return f.id;
        }
      }
    }
    return null;
  }
  function stateOf(fips) { return FIPS_ST[String(fips || '').slice(0, 2)] || null; }

  /* ── ranks ────────────────────────────────────────────────────── */
  /* Rank of one county's figure among the state's counties that carry it.
     rank 1 = the highest number. pos 0..1 (1 = top), ties share the middle. */
  function rankIn(pct, fips, i) {
    var me = pct.counties[fips] && pct.counties[fips].v[i];
    if (me == null) return null;
    var above = 0, below = 0, eq = 0, n = 0;
    Object.keys(pct.counties).forEach(function (f) {
      var v = pct.counties[f].v[i];
      if (v == null) return;
      n++;
      if (v > me) above++; else if (v < me) below++; else eq++;
    });
    var pos = n > 1 ? (below + (eq - 1) / 2) / (n - 1) : 0.5;
    return { rank: above + 1, n: n, tied: eq - 1, pos: Math.round(pos * 1000) / 1000 };
  }

  /* ── formatting ───────────────────────────────────────────────── */
  function commas(n) { var s = String(n), neg = s.charAt(0) === '-', p = (neg ? s.slice(1) : s).split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (neg ? '-' : '') + p.join('.'); }
  function fixed(v, dp) { return commas(Number(v).toFixed(dp)); }
  function fmt(v, m) {
    if (v == null) return 'not available';
    var dp = m.dp == null ? 1 : m.dp;
    if (m.unit === '$/ac') return '$' + fixed(v, 0) + ' an acre';
    if (/^%/.test(m.unit)) return fixed(v, dp) + '%' + (m.unit === '% of weeks' ? ' of weeks' : m.unit === '% of acres' ? ' of harvested acres' : ' of cropland');
    if (m.unit === 'paid out / premium') return fixed(v, 2) + ' (paid out per $1 of premium)';
    if (m.unit === 'deg F') return fixed(v, dp) + '°F';
    if (m.unit === 'GDD') return fixed(v, 0) + ' GDD';
    return fixed(v, dp) + ' ' + m.unit;
  }
  function fmtShort(v, m) {
    if (v == null) return 'n/a';
    var dp = m.dp == null ? 1 : m.dp;
    if (m.unit === '$/ac') return '$' + fixed(v, 0);
    if (/^%/.test(m.unit)) return fixed(v, dp) + '%';
    if (m.unit === 'deg F') return fixed(v, dp) + '°F';
    if (m.unit === 'paid out / premium') return fixed(v, 2);
    return fixed(v, dp) + ' ' + (m.unit === 'head / 1,000 ac' ? 'head per 1,000 ac' : m.unit);
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function rankWords(r, stName) {
    if (!r) return '';
    if (r.n < MIN_RANK_N) return 'too few ' + stName + ' counties carry this figure to rank (' + r.n + ')';
    var tie = r.tied ? ', tied with ' + r.tied + (r.tied === 1 ? ' other' : ' others') : '';
    if (r.pos < 0.5) {
      var low = r.n - r.rank - r.tied + 1;
      return (low === 1 && !r.tied ? 'lowest' : ordinal(low) + ' lowest') + ' of ' + r.n + ' ' + stName + ' counties' + tie;
    }
    return (r.rank === 1 && !r.tied ? 'highest' : ordinal(r.rank) + ' highest') + ' of ' + r.n + ' ' + stName + ' counties' + tie;
  }

  /* ── the profile ──────────────────────────────────────────────── */
  /* reg: an AGLayers.load() result (or null). Returns null when the county is not in the file. */
  function profile(pct, fips, reg) {
    var c = pct && pct.counties && pct.counties[fips];
    if (!c) return null;
    var st = pct.state, stName = pct.name || STATES[st];
    var cols = pct.metrics.map(function (m, i) {
      var layer = reg && reg.byId ? reg.byId[m.layer] : null;
      var r = rankIn(pct, fips, i);
      var other = c.o && c.o[String(i)];
      var col = {
        i: i, id: m.id, layer: m.layer, label: m.label, short: m.short, unit: m.unit, dp: m.dp, better: m.better,
        value: c.v[i], year: m.year || null, years: m.id === 'yield' && c.yw ? c.yw : m.years,
        rank: r && r.n >= MIN_RANK_N ? r.rank : null, n: r ? r.n : m.n, tied: r ? r.tied : 0,
        pos: r && r.n >= MIN_RANK_N ? r.pos : null,
        band: null,
        reason: c.w ? c.w[String(i)] || null : null,
        other: other ? { value: other[0], year: other[1] } : null,
        source: layer ? layer.source : null, sourceUrl: layer ? layer.source_url : null
      };
      if (col.value == null && !col.reason) col.reason = 'no figure in the source for this county';
      if (col.pos != null && r.n >= 10) col.band = col.pos >= 1 - BAND ? 'top' : col.pos <= BAND ? 'bottom' : null;
      col.words = col.value == null ? '' : rankWords(r, stName);
      return col;
    });
    var unusual = (c.u || []).map(function (u) {
      var col = cols[u[0]];
      return { i: u[0], id: col.id, label: col.label, short: col.short, value: col.value, nb: u[1], nbN: u[2], score: u[3],
        unusual: u[3] >= (pct.unusual_min || 1), dir: col.value > u[1] ? 'higher' : col.value < u[1] ? 'lower' : 'same', col: col };
    });
    var p = {
      fips: fips, st: st, stName: stName, name: c.n, slug: c.s, flags: c.k || '',
      center: c.c ? { lat: c.c[0], lng: c.c[1] } : null,
      neighbors: (c.nb || []).map(function (f) { return { fips: f, name: pct.counties[f] ? pct.counties[f].n : null, st: stateOf(f) }; }),
      atlasGenerated: pct.atlas_generated || null, cols: cols, unusual: unusual
    };
    p.sentence = sentence(p);
    return p;
  }

  /* THE ONE SENTENCE. A fixed template, filled only from numbers in the profile:
       <Name>, <ST>: <lead figure>, <its rank>[; <the figure nearest a state edge>, in the top or bottom
       tenth][; furthest from its neighbors on <figure>: <here> against <neighbor median> across <n>].
     Lead figure: cash rent, else land value, else corn yield, else the first figure the county has. */
  var SAY = {
    rent: function (c) { return 'cash rent ' + fmt(c.value, c) + (c.year ? ' in ' + c.year : ''); },
    land_value: function (c) { return 'farmland worth ' + fmt(c.value, c) + (c.year ? ' in the ' + c.year + ' census' : ''); },
    yield: function (c) { return 'a middle corn yield of ' + fixed(c.value, 1) + ' bu/ac (' + c.years + ')'; },
    loss_ratio: function (c) { return 'a crop insurance loss ratio of ' + fixed(c.value, 2) + ' over ' + c.years; },
    drought: function (c) { return 'severe drought or worse in ' + fixed(c.value, 1) + '% of weeks since 2000'; },
    hail: function (c) { return fixed(c.value, 2) + ' days a year with 1 inch hail reported (' + c.years + ')'; },
    gs_rain: function (c) { return fixed(c.value, 1) + ' inches of April to September rain in a normal year'; },
    frost_free: function (c) { return fixed(c.value, 0) + ' frost-free days in a middle year'; },
    gdd: function (c) { return fixed(c.value, 0) + ' corn GDD from May to September in a middle year'; },
    july_nights: function (c) { return 'July night lows averaging ' + fixed(c.value, 1) + '\u00b0F (' + c.years + ')'; },
    irrigated: function (c) { return fixed(c.value, 1) + '% of harvested acres irrigated'; },
    tile: function (c) { return fixed(c.value, 1) + '% of cropland tiled'; },
    notill: function (c) { return fixed(c.value, 1) + '% of cropland in no-till'; },
    cover: function (c) { return fixed(c.value, 1) + '% of cropland in cover crops'; },
    crp: function (c) { return fixed(c.value, 1) + '% of cropland in CRP'; },
    cattle: function (c) { return fixed(c.value, 1) + ' cattle per 1,000 acres of farmland'; },
    wind_solar: function (c) { return fixed(c.value, 1) + ' MW of wind and solar running'; }
  };
  function say(c) { return SAY[c.id] ? SAY[c.id](c) : lowerFirst(c.label) + ' ' + fmt(c.value, c); }
  function sentence(p) {
    var head = p.name + ', ' + p.st + ': ';
    var have = p.cols.filter(function (c) { return c.value != null; });
    if (!have.length) return head + 'the public records we read carry no county figures here. Each missing figure is listed below with its reason.';
    var lead = null;
    ['rent', 'land_value', 'yield'].some(function (id) { lead = have.filter(function (c) { return c.id === id; })[0] || null; return !!lead; });
    if (!lead) lead = have[0];
    var parts = [say(lead) + (lead.rank != null ? ', ' + lead.words : '')];
    var edge = have.filter(function (c) { return c !== lead && c.band; })
      .sort(function (a, b) { return Math.abs(b.pos - 0.5) - Math.abs(a.pos - 0.5) || a.i - b.i; })[0];
    if (edge) parts.push(say(edge) + ', in the ' + (edge.band === 'top' ? 'top' : 'bottom') + ' tenth of ' + p.stName + ' counties');
    var u = p.unusual.filter(function (x) { return x.unusual && (!edge || x.i !== edge.i) && x.i !== lead.i; })[0];
    if (u) parts.push('furthest from its neighbors on ' + lowerFirst(u.short) + ': ' + fmtShort(u.value, u.col) + ' here against ' + fmtShort(u.nb, u.col) + ' across ' + u.nbN + ' neighboring counties');
    return head + parts.join('; ') + '.';
  }
  function lowerFirst(s) { s = String(s || ''); return /^[A-Z][a-z]/.test(s) && !/^(April|May|July|June|CRP|GDD)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  /* ── this week ────────────────────────────────────────────────── */
  function miles(a, b, c, d) {
    var R = 3958.8, toR = Math.PI / 180, dLat = (c - a) * toR, dLon = (d - b) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* County rain since Jan 1 from data/rain/<st>.json. */
  function rainSoFar(file, fips) {
    if (!file || !file.counties) return { status: 'missing', why: 'the county rain file did not load' };
    var c = file.counties[fips];
    if (!c) {
      var none = file.none && file.none[fips];
      return { status: 'none', why: none ? 'no weather station with a full record in this county; the nearest county with one is ' + none.near : 'no county rain figure for this county' };
    }
    var cum = c.cum || [], last = cum[cum.length - 1];
    if (!last || last[1] == null) return { status: 'none', why: 'no rain total this year yet' };
    var normal = last[2], pct = normal ? Math.round(last[1] / normal * 100) : null;
    return { status: 'ok', inches: last[1], normal: normal, pct: pct, through: c.as_of || file.edate, year: file.year,
      normals: file.normals, source: file.source, lastYear: c.last && c.last.this_both != null ? c.last.this_both : null };
  }

  /* This week's Drought Monitor for one county (data/drought/county-week.json). */
  var DCAT = ['D0 abnormally dry', 'D1 moderate drought', 'D2 severe drought', 'D3 extreme drought', 'D4 exceptional drought'];
  function droughtNow(file, fips) {
    if (!file) return { status: 'missing', why: 'the drought file did not load' };
    var rows = file.c && file.c[fips];
    if (!rows && file.zero && file.zero.indexOf(fips) >= 0) rows = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    if (!rows || !rows[0]) return { status: 'none', why: 'no Drought Monitor row for this county this week' };
    var now = rows[0], worst = -1;
    for (var k = 4; k >= 0; k--) if (now[k] > 0) { worst = k; break; }
    var four = rows[2];
    return { status: 'ok', valid: file.valid, prev4: file.prev4, now: now, fourAgo: four, worst: worst,
      worstWords: worst < 0 ? 'none of the county in drought or abnormally dry' : DCAT[worst],
      worstPct: worst < 0 ? 0 : now[worst], d1: now[1], d1FourAgo: four ? four[1] : null, source: file.source, url: file.url };
  }

  /* Hail reports within HAIL_MILES in data/hail/recent.json (30 days of NWS storm reports). */
  function hailNear(file, lat, lng, radius) {
    radius = radius || HAIL_MILES;
    if (!file || !file.reports) return { status: 'missing', why: 'the hail report file did not load' };
    if (lat == null || lng == null) return { status: 'none', why: 'no point to measure from' };
    var hits = file.reports.filter(function (r) { return r.lat != null && r.lon != null && miles(lat, lng, r.lat, r.lon) <= radius; })
      .map(function (r) { return { date: r.date, mag: r.mag, city: r.city, st: r.st, mi: Math.round(miles(lat, lng, r.lat, r.lon)) }; })
      .sort(function (a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : b.mag - a.mag; });
    var big = hits.reduce(function (m, r) { return r.mag > m ? r.mag : m; }, 0);
    return { status: 'ok', days: file.days, through: file.generated, radius: radius, n: hits.length, biggest: hits.length ? big : null, latest: hits[0] || null };
  }

  /* USDA AgTransport regional basis for the state vs its 5-year same-week normal
     (data/transport/basis.json), held to the week the /basis page shows. */
  function basisVsNormal(file, st, crop) {
    crop = crop || 'Corn';
    if (!file || !file.series) return { status: 'missing', why: 'the USDA basis file did not load' };
    var name = STATES[st], s = file.series[crop + '|' + name + '|Elevator Bid'];
    if (!s) return { status: 'none', why: 'USDA AgTransport tracks no ' + name + ' elevator-bid region' };
    var wk = file.weeks && file.weeks[crop + '|Elevator Bid'];
    var week = wk ? wk.week : s.date;
    if (s.date !== week) return { status: 'none', why: 'USDA last posted ' + name + ' for the week of ' + s.date + ', not the week of ' + week };
    if (s.latest == null || s.avg5 == null) return { status: 'none', why: 'no 5-year normal for this week' };
    return { status: 'ok', crop: crop, region: name, week: week, latest: s.latest, normal: s.avg5, normalYears: s.avg5_n, delta: s.delta, source: file.source };
  }
  /* The state's median basis at the elevators we read (data/basis-states.json). */
  function stateBasis(file, st, crop) {
    var s = file && file.states && file.states[st], c = s && s.crops && s.crops[crop];
    if (!c || typeof c.median !== 'number') return { status: 'none', why: 'fewer than ' + ((file && file.min_n) || 3) + ' ' + (STATES[st] || st) + ' elevators with a fresh ' + crop + ' bid' };
    return { status: 'ok', median: c.median, n: c.n, label: c.label, contract: c.contract, wow: c.wow, asOf: file.generated };
  }

  /* Best and nearest bid per crop from a bids snapshot ({ bids: [...] } rows with cashPrice, distance, lat/lon).
     Rows marked verified:false, or with no price, never count. Distances from (lat, lng) when given. */
  var OUTLIER_BASIS = 0.75;   // a bid whose basis sits this far from the crop's median nearby never counts as best
  function bestBids(snap, lat, lng, radius) {
    radius = radius || BID_MILES;
    var by = {}, out = {};
    if (!snap || !snap.bids) return out;
    snap.bids.forEach(function (b) {
      var crop = String(b.crop || b.category || b.commodity || '').toLowerCase();
      if (/^soy/.test(crop)) crop = 'soybeans'; else if (/^corn/.test(crop)) crop = 'corn'; else if (/wheat/.test(crop)) crop = 'wheat'; else return;
      if (b.verified === false || typeof b.cashPrice !== 'number' || !isFinite(b.cashPrice) || b.cashPrice <= 0) return;
      var d = lat != null && lng != null && b.lat != null && b.lon != null ? miles(lat, lng, b.lat, b.lon) : b.distance;
      if (d == null || d > radius) return;
      (by[crop] = by[crop] || []).push({ crop: crop, price: b.cashPrice, basis: typeof b.basis === 'number' ? b.basis : null,
        facility: b.facility || '', town: b.town || b.city || '', st: b.state || '', mi: Math.round(d),
        delivery: b.delivery || b.period || '', pricedAt: b.pricedAt || null });
    });
    Object.keys(by).forEach(function (crop) {
      var rows = by[crop], bs = rows.map(function (r) { return r.basis; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
      var med = bs.length ? (bs.length % 2 ? bs[(bs.length - 1) / 2] : (bs[bs.length / 2 - 1] + bs[bs.length / 2]) / 2) : null;
      var o = out[crop] = { n: rows.length, left_out: 0, best: null, nearest: null, medianBasis: med };
      rows.forEach(function (r) {
        if (bs.length >= 5 && r.basis != null && Math.abs(r.basis - med) > OUTLIER_BASIS) { o.left_out++; return; }
        if (!o.best || r.price > o.best.price || (r.price === o.best.price && r.mi < o.best.mi)) o.best = r;
        if (!o.nearest || r.mi < o.nearest.mi) o.nearest = r;
      });
    });
    return out;
  }

  /* The next USDA report after `now` in /usda-calendar.ics (CONAB and StatCan rows left out). */
  function nextReport(ics, now) {
    if (!ics) return null;
    now = now || new Date();
    var best = null;
    String(ics).replace(/\r/g, '').replace(/\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1).forEach(function (b) {
      var s = /\nSUMMARY:([^\n]*)/.exec('\n' + b), d = /\nDTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z/.exec('\n' + b);
      if (!s || !d) return;
      var name = s[1].replace(/\\,/g, ',').trim();
      if (/CONAB|StatCan|Brazil|Canada/i.test(name)) return;
      var at = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5]));
      if (at <= now) return;
      if (!best || at < best.at) best = { name: name, at: at };
    });
    return best;
  }

  /* ── the long view ────────────────────────────────────────────── */
  /* Year rows from the county's own Atlas file: corn yield, rent, weeks in D2+, loss ratio. */
  function longView(county) {
    if (!county) return [];
    var rows = [];
    function series(id, label, unit, obj, pick, src) {
      if (!obj) return;
      var pts = Object.keys(obj).filter(function (y) { return /^\d{4}$/.test(y); }).sort().map(function (y) { return [+y, pick(obj[y])]; })
        .filter(function (p) { return p[1] != null && isFinite(p[1]); });
      if (pts.length >= 3) rows.push({ id: id, label: label, unit: unit, pts: pts, source: src });
    }
    var y = county.yield, r = county.rent, d = county.drought, s = county.sob;
    if (y && y.status === 'ok') series('yield', 'Corn yield', 'bu/ac', y.hist, function (v) { return v; }, 'USDA NASS');
    if (r && r.status === 'ok') series('rent', 'Cash rent, nonirrigated', '$/ac', r.series_nonirr, function (v) { return v; }, 'USDA NASS Cash Rents Survey');
    if (d && d.status === 'ok') series('drought', 'Weeks in D2+ drought', 'weeks', d.series, function (v) { return v && v.d2 != null ? v.d2 : null; }, 'U.S. Drought Monitor');
    if (d && d.status === 'ok' && d.partial_year && rows.length && rows[rows.length - 1].id === 'drought') rows[rows.length - 1].partial = d.partial_year.year;
    if (s && s.status === 'ok') series('loss', 'Crop insurance loss ratio', 'paid / premium', s.per_year, function (v) { return v && v.ratio != null && !v.partial ? v.ratio : null; }, 'USDA RMA Summary of Business');
    return rows;
  }

  return {
    ROLES: ROLES, SECTIONS: SECTIONS, STATES: STATES, FIPS_ST: FIPS_ST, MIN_RANK_N: MIN_RANK_N,
    role: role, order: order, tool: tool, parseQuery: parseQuery, parsePoint: parsePoint, classify: classify,
    splitState: splitState, normName: normName, stateFromName: stateFromName, findCounty: findCounty,
    countyInState: countyInState, countyAt: countyAt, stateOf: stateOf, rankIn: rankIn, profile: profile,
    sentence: sentence, fmt: fmt, fmtShort: fmtShort, ordinal: ordinal, miles: miles, rainSoFar: rainSoFar,
    droughtNow: droughtNow, hailNear: hailNear, basisVsNormal: basisVsNormal, stateBasis: stateBasis,
    bestBids: bestBids, nextReport: nextReport, longView: longView, stSlug: stSlug
  };
});
