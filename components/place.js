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

  /* ── sections and the go deeper row ──────────────────────────── */
  // One fixed order for everyone (Sig, Oct 19: no role chips, every reader sees everything).
  var SECTIONS = ['week', 'fingerprint', 'unusual', 'long'];
  // What the Print report panel can leave out, in page order.
  var PRINT_PARTS = ['sentence', 'week', 'fingerprint', 'unusual', 'long', 'sources'];

  function stSlug(st) { return String(STATES[st] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

  /* Every tool for one place, the same row for everyone, built from what the place supports.
     place: { fips, st, slug, flags, lat, lng, zip, point, sales } where sales is true when
     AGSIST holds recorded sales for the state (data/land/<st>/index.json has counties). */
  function deeper(place) {
    if (!place || !place.fips || !STATES[place.st]) return [];
    var s = stSlug(place.st), f = place.flags || '', out = [];
    var has = place.lat != null && place.lng != null && isFinite(+place.lat) && isFinite(+place.lng);
    var lat = has ? (+place.lat).toFixed(4) : '', lng = has ? (+place.lng).toFixed(4) : '';
    if (has) out.push({ id: 'scout', href: '/field-scout?at=' + lat + ',' + lng + '&fips=' + place.fips, text: 'Field Scout at this spot' });
    if (has && place.sales) out.push({ id: 'comps', href: '/comp-report?lat=' + lat + '&lon=' + lng + (place.point ? '' : '&at=town') + '&fips=' + place.fips, text: 'Comparable sales report' });
    out.push(place.zip ? { id: 'bids', href: '/cash-bids?zip=' + place.zip, text: 'Cash bids near here' }
      : { id: 'bids', href: '/cash-bids/' + s + '/', text: 'Cash bids across ' + STATES[place.st] });
    if (has) out.push({ id: 'hail', href: '/hail-map?lat=' + lat + '&lon=' + lng, text: 'Hail report for this spot' });
    out.push({ id: 'sheet', href: '/farmland-atlas/sheet#' + place.fips, text: 'Printable county sheet' });
    if (f.indexOf('a') >= 0) out.push({ id: 'atlas', href: '/farmland-atlas/' + s + '/' + place.slug, text: 'Farmland Atlas county page' });
    if (f.indexOf('c') >= 0) out.push({ id: 'arcplc', href: '/arc-plc/' + s + '/' + place.slug, text: 'ARC or PLC for this county' });
    if (f.indexOf('p') >= 0) out.push({ id: 'prf', href: '/prf/' + s + '/' + place.slug, text: 'PRF pasture insurance' });
    if (f.indexOf('r') >= 0) out.push({ id: 'rain', href: '/rain/' + s + '/' + place.slug, text: 'Rain this year, county page' });
    out.push({ id: 'rent', href: '/rent/' + s, text: STATES[place.st] + ' cash rent' });
    return out;
  }

  /* &print=week,long,more,rain: the parts a shared link prints. Unknown words are dropped; no
     known part means everything. more = the table of years printed in full; rain = the year's
     rain drawn (off unless chosen). */
  function parsePrint(v) {
    var parts = [], more = false, rain = false;
    String(v || '').toLowerCase().split(/[,\s]+/).forEach(function (w) {
      if (w === 'more') more = true;
      else if (w === 'rain') rain = true;
      else if (PRINT_PARTS.indexOf(w) >= 0 && parts.indexOf(w) < 0) parts.push(w);
    });
    if (!parts.length) parts = PRINT_PARTS.slice();
    return { parts: PRINT_PARTS.filter(function (p) { return parts.indexOf(p) >= 0; }), more: more, rain: rain };
  }
  /* The print choice as one number for the QR link: bit i = PRINT_PARTS[i] on, 64 = more, 128 = rain. */
  function printCode(choice) {
    var n = 0;
    PRINT_PARTS.forEach(function (p, i) { if (choice && choice.parts && choice.parts.indexOf(p) >= 0) n |= 1 << i; });
    if (!n) n = 63;
    if (choice && choice.more) n |= 64;
    if (choice && choice.rain) n |= 128;
    return n;
  }
  function printFromCode(n) {
    var parts = PRINT_PARTS.filter(function (p, i) { return n & (1 << i); });
    return { parts: parts.length ? parts : PRINT_PARTS.slice(), more: !!(n & 64), rain: !!(n & 128) };
  }
  /* The link the printed QR code carries: the shortest that reopens the same report.
     Uppercase scheme and host (QR stores them the same; phones read them the same), the
     case-sensitive path as is, short keys, no label, no tracking. place: { fips, zip, at, print }. */
  function qrLink(place) {
    if (!place || !place.fips) return '';
    var q = ['f=' + place.fips];
    if (place.zip) q.push('z=' + place.zip);
    else if (place.at) q.push('a=' + (+place.at.lat).toFixed(4) + ',' + (+place.at.lng).toFixed(4));
    var n = printCode(place.print);
    if (n !== 63) q.push('p=' + n);
    // the common case goes as a short path (404.html routes /H/ back here, components/report-link.js):
    // all QR letters-and-digits, 25 x 25 instead of 29 x 29 (Sig, Oct 19: smallest QR always)
    // Oct 22 panel: a spot or a print choice rides the same short path (it was /here?..., one more hop
    // through the forward forever): H/<fips>[/<ZIP> | /A<lat><lng>][/P<print code>], all QR letters and digits
    var h = 'HTTPS://AGSIST.COM/H/' + place.fips;
    if (place.zip) h += '/' + place.zip;
    else if (place.at) { var lo = (+place.at.lng).toFixed(4); h += '/A' + (+place.at.lat).toFixed(4) + (lo.charAt(0) === '-' ? '' : '+') + lo; }
    if (n !== 63) h += '/P' + n;
    return h;
  }
  /* The &print= value for a choice; '' when it is the default (everything, no more detail). */
  function printParam(choice) {
    var parts = PRINT_PARTS.filter(function (p) { return choice && choice.parts && choice.parts.indexOf(p) >= 0; });
    if (!parts.length) parts = PRINT_PARTS.slice();
    var all = parts.length === PRINT_PARTS.length, more = !!(choice && choice.more), rain = !!(choice && choice.rain);
    if (all && !more && !rain) return '';
    return (all ? [] : parts).concat(more ? ['more'] : [], rain ? ['rain'] : []).join(',');
  }

  /* ── the query ────────────────────────────────────────────────── */
  function num(x) { var n = typeof x === 'number' ? x : (x == null || x === '' ? NaN : Number(x)); return isFinite(n) ? n : null; }
  function parseQuery(search) {
    var out = { q: '', fips: null, zip: null, at: null, print: null };
    var s = String(search || '').replace(/^\?/, '');
    s.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' ')), v = '';
      try { v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { v = ''; }
      v = v.trim();
      // f z a p: the short keys the printed QR code carries (smallest symbol; see qrLink)
      if (k === 'q') out.q = v.slice(0, 80);
      else if ((k === 'fips' || k === 'f') && /^\d{5}$/.test(v) && FIPS_ST[v.slice(0, 2)]) out.fips = v;
      else if ((k === 'zip' || k === 'z') && /^\d{5}$/.test(v)) out.zip = v;
      else if (k === 'at' || k === 'a') out.at = parsePoint(v);
      else if (k === 'print') out.print = parsePrint(v);
      else if (k === 'p') out.print = /^\d{1,3}$/.test(v) && +v < 256 ? printFromCode(+v) : parsePrint(v);
      // &for= (the old role chips, removed Oct 19) and any other key: ignored
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
    if (m.unit === 'paid out / premium') return '$' + fixed(v, 2) + ' paid out per $1 of total premium';
    if (m.unit === 'deg F') return fixed(v, dp) + '°F';
    if (m.unit === 'GDD') return fixed(v, 0) + ' GDD';
    return fixed(v, dp) + ' ' + m.unit;
  }
  function fmtShort(v, m) {
    if (v == null) return 'n/a';
    var dp = m.dp == null ? 1 : m.dp;
    if (m.unit === '$/ac') return '$' + fixed(v, 0);
    if (/^%/.test(m.unit)) return fixed(v, dp) + '%' + (m.unit === '% of weeks' ? ' of weeks' : '');   // the drought weeks figure is a share of weeks (Oct 22 panel: "weeks" over a bare percent)
    if (m.unit === 'deg F') return fixed(v, dp) + '°F';
    if (m.unit === 'paid out / premium') return '$' + fixed(v, 2);
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
  /* One name for a figure everywhere it shows (Oct 21 panel): the build's label, reworded here. */
  var LABEL = { loss_ratio: ['Crop insurance paid out per $1 of total premium, last 10 years', 'Paid out per $1'], land_value: ['Farmland value, land and buildings as farmers reported them', 'Land value'], rent: ['Cash rent, non-irrigated cropland', 'Rent'] };
  function profile(pct, fips, reg) {
    var c = pct && pct.counties && pct.counties[fips];
    if (!c) return null;
    var st = pct.state, stName = pct.name || STATES[st];
    var cols = pct.metrics.map(function (m, i) {
      var layer = reg && reg.byId ? reg.byId[m.layer] : null;
      var r = rankIn(pct, fips, i);
      var other = c.o && c.o[String(i)];
      var col = {
        i: i, id: m.id, layer: m.layer, label: LABEL[m.id] ? LABEL[m.id][0] : m.label, short: LABEL[m.id] ? LABEL[m.id][1] : m.short, unit: m.unit, dp: m.dp, better: m.better,
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
    rent: function (c) { return 'cash rent ' + fmt(c.value, c) + ' for non-irrigated cropland' + (c.year ? ' in ' + c.year : ''); },
    land_value: function (c) { return 'land and buildings worth ' + fmt(c.value, c) + ' as farmers reported it' + (c.year ? ' in the ' + c.year + ' Census' : ''); },
    yield: function (c) { return 'a middle corn yield of ' + fixed(c.value, 1) + ' bu/ac (' + c.years + ')'; },
    loss_ratio: function (c) { return 'crop insurance paid out $' + fixed(c.value, 2) + ' per $1 of total premium (farmer and federal shares), ' + c.years + ' together'; },
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
    if (edge) parts.push(say(edge) + ', among the ' + (edge.band === 'top' ? 'highest' : 'lowest') + ' tenth of ' + p.stName + ' counties');
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
    var mo = c.months && c.months.length ? c.months[c.months.length - 1] : null;
    return { status: 'ok', inches: last[1], normal: normal, pct: pct, through: c.as_of || file.edate, year: file.year,
      normals: file.normals, source: file.source, lastYear: c.last && c.last.this_both != null ? c.last.this_both : null,
      month: mo && mo[0] != null ? { i: c.months.length - 1, inches: mo[0], usual: mo[1], days: mo[3] } : null,
      station: c.station ? { name: c.station.name, mi: c.station.mi } : null, county: c.name || null };
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
    var four = rows[2], k = file.k && file.k[fips] ? file.k[fips] : null;
    return { status: 'ok', valid: file.valid, prev4: file.prev4, now: now, fourAgo: four, worst: worst, streak: k,
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
        delivery: b.delivery || b.period || '', start: b.deliveryStart || null, pricedAt: b.pricedAt || null });
    });
    Object.keys(by).forEach(function (crop) {
      var rows = by[crop], bs = rows.map(function (r) { return r.basis; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
      var med = bs.length ? (bs.length % 2 ? bs[(bs.length - 1) / 2] : (bs[bs.length / 2 - 1] + bs[bs.length / 2]) / 2) : null;
      var o = out[crop] = { n: rows.length, left_out: 0, best: null, nearest: null, medianBasis: med, nBasis: bs.length };
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
      else if (+at === +best.at && best.name.split(' and ').indexOf(name) < 0) best.name += ' and ' + name;
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
    if (r && r.status === 'ok') series('rent', 'Cash rent, non-irrigated cropland', '$/ac', r.series_nonirr, function (v) { return v; }, 'USDA NASS Cash Rents Survey');
    if (d && d.status === 'ok') series('drought', 'Severe drought (D2) or worse', 'weeks a year', d.series, function (v) { return v && v.d2 != null ? v.d2 : null; }, 'U.S. Drought Monitor');
    if (d && d.status === 'ok' && d.partial_year && rows.length && rows[rows.length - 1].id === 'drought') rows[rows.length - 1].partial = d.partial_year.year;
    if (s && s.status === 'ok') series('loss', 'Crop insurance paid out per $1 of total premium', '$ per $1', s.per_year, function (v) { return v && v.ratio != null && !v.partial ? v.ratio : null; }, 'USDA RMA Summary of Business');
    return rows;
  }

  /* ── the first screen: the year's rain at the county station (Oct 19) ──────────
     The station is the county rain page's own pick (data/rain/<st>.json, built by
     scripts/fetch_county_rain.py), so /here and /rain/<state>/<county> always draw
     the same gauge, the same days and the same total. */
  function roundHalfEven(x) {   // Python's round(), so the miles read as the county page prints them
    var f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  function milesFrom(mi) { var n = roundHalfEven(mi); return n === 0 ? 'less than a mile from' : n === 1 ? '1 mile from' : n + ' miles from'; }
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function md(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON3[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  /* What the county rain page's Rain Print figure carries (scripts/build_county_rain.py chart()),
     from the same county record. null when the county has no rain record. The print itself
     (components/rain-county-print.js mount) still checks the days and total against these. */
  function rainFigure(file, fips) {
    var c = file && file.counties && file.counties[fips];
    if (!c || !c.station || !c.cum || !c.cum.length || c.total == null) return null;
    var st = String(file.state || stateOf(fips) || '').toUpperCase(), stName = STATES[st] || st;
    var mn = null;
    if (c.usual != null && c.months && c.months.length && c.months.every(function (m) { return m[1] != null; })) {
      var sum = c.months.reduce(function (a, m) { return a + m[1]; }, 0);
      if (Math.abs(sum - c.usual) <= 0.015) mn = c.months.map(function (m) { return m[1].toFixed(2); }).join(',');
    }
    var noun = c.station.net === 'cocorahs' ? 'gauge' : 'station';
    var leap = file.year % 4 === 0 && (file.year % 100 !== 0 || file.year % 400 === 0);
    return {
      st: st.toLowerCase(), fips: fips, year: file.year, days: c.days, total: c.total, usual: c.usual, pct: c.pct,
      place: c.name + ', ' + stName, county: c.name, asOf: c.as_of || file.edate, missing: c.missing || 0, noun: noun,
      done: c.days >= (leap ? 366 : 365),
      gauge: 'Weather ' + noun + ': ' + c.station.name + ', ' + milesFrom(c.station.mi) + ' the middle of ' + c.name,
      station: { name: c.station.name, sid: c.station.sid, mi: c.station.mi, net: c.station.net, ll: c.station.ll },
      mn: mn, norm: file.normals === '1991-2020' ? '1991-2020' : '30', normals: file.normals, cum: c.cum, source: file.source
    };
  }
  /* The plain running total, drawn at once while the Rain Print loads (and kept if it cannot
     draw): the county page's placeholder chart, the same weekly points (c.cum: [day, this year,
     usual]). SVG text only; the page styles it with the county page's own classes. */
  function rainChart(f) {
    if (!f || !f.cum || !f.cum.length) return '';
    var W = 420, H = 210, L = 30, R = 50, T = 10, B = 26, year = f.year;
    var nYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
    var pts = f.cum, hasUs = f.usual != null && pts.every(function (p) { return p[2] != null; });
    var top = Math.max(f.total, hasUs ? f.usual : 0, 1);
    var step = top <= 6 ? 1 : top <= 12 ? 2 : top <= 40 ? 5 : 10, ymax = step * (Math.floor(top / step) + 1);
    var pw = W - L - R, ph = H - T - B;
    function X(d) { return L + pw * d / nYear; }
    function Y(v) { return T + ph * (1 - v / ymax); }
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Running total of rain at the ' + f.noun + ' for ' + f.county + ', ' + year + (hasUs ? ', against a usual year' : '') + '">'];
    for (var v = 0; v <= ymax; v += step) {
      var y = Y(v).toFixed(0);
      out.push('<path class="' + (v === 0 ? 'rc-ax' : 'rc-grid') + '" d="M' + L + ' ' + y + 'H' + (W - R) + '"/><text class="rc-lab" x="' + (L - 6) + '" y="' + (+y + 4) + '" text-anchor="end">' + v + '</text>');
    }
    for (var m = 0; m < 12; m++) {
      var doy = Math.round((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 864e5);
      out.push('<text class="rc-lab" x="' + X(doy + 15).toFixed(0) + '" y="' + (H - 8) + '" text-anchor="middle">' + MON3[m].charAt(0) + '</text>');
    }
    function path(k) { return 'M' + X(0).toFixed(1) + ',' + Y(0).toFixed(1) + pts.map(function (p) { return 'L' + X(p[0] + 1).toFixed(1) + ',' + Y(p[k]).toFixed(1); }).join(''); }
    if (hasUs) out.push('<path class="rc-us" d="' + path(2) + '"/>');
    out.push('<path class="rc-yr" d="' + path(1) + '"/>');
    var last = pts[pts.length - 1], xe = (X(last[0] + 1) + 5).toFixed(1), ly = Y(last[1]), lu = hasUs ? Y(last[2]) : null;
    if (hasUs && Math.abs(ly - lu) < 18) { var mid = (ly + lu) / 2, up = ly <= lu ? -1 : 1; ly = mid + up * 9; lu = mid - up * 9; }
    var ys = [ly].concat(hasUs ? [lu] : []), sh = Math.max(0, 10 - Math.min.apply(null, ys));
    sh -= Math.max(0, Math.max.apply(null, ys) + sh - (H - B - 4));
    out.push('<text class="rc-yl" x="' + xe + '" y="' + (ly + sh + 4).toFixed(1) + '">' + year + '</text>');
    if (hasUs) out.push('<text class="rc-lab" x="' + xe + '" y="' + (lu + sh + 4).toFixed(1) + '">Usual</text>');
    return out.join('') + '</svg>';
  }

  /* THE RANKED LINE: this year's rain from Jan 1 to the last reported day, against the same
     calendar days of every earlier year the station recorded in full.
       rows    the station's period of record from RCC-ACIS (StnData sdate=por, elems pcpn),
               the call components/rain-print.js stationExtremes() makes
       fig     rainFigure(): the year, the last day (asOf) and the total the page draws
     Rules (set Oct 19 before any station was ranked; the engine's own words for each):
       - a year counts only when every day of the window has a report (no M, no missing row)
         and every S run (rain counted later) closes on its A day inside the window, the
         AgRainExtras.fullYears rule cut to the window
       - this year must pass the same test, and its total from the record must equal the
         drawn total (within 0.011 in); otherwise nothing is ranked (two numbers never disagree)
       - at least RANK_MIN (30, the engine's HIST_MIN) years including this one, else withheld
       - ties within 0.005 in; ranked from the nearer end, as AgRainExtras.rank does
     test/place.test.mjs checks that on a whole year this gives AgRainExtras.rank's answer. */
  var RANK_MIN = 30;
  function pcpn(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === 'T') return { v: 0, f: 'T' };
    if (s === 'S') return { v: 0, f: 'S' };
    var v = parseFloat(s);
    if (s === 'M' || s === '' || isNaN(v)) return { v: null, f: 'M' };
    return { v: v, f: /A$/.test(s) ? 'A' : '' };
  }
  function windowTotals(rows, mmdd) {
    var by = {}, years = [];
    (rows || []).forEach(function (r) {
      if (!r || !/^\d{4}-\d\d-\d\d$/.test(r[0])) return;
      var y = +r[0].slice(0, 4);
      if (r[0].slice(5) > mmdd) return;
      if (!by[y]) { by[y] = {}; years.push(y); }
      by[y][r[0]] = r[1];
    });
    var out = {};
    years.forEach(function (y) {
      var m = +mmdd.slice(0, 2), d = +mmdd.slice(3, 5), end = Date.UTC(y, m - 1, d);
      if (new Date(end).getUTCDate() !== d) end = Date.UTC(y, m - 1, d - 1);   // Feb 29 in a common year
      var tot = 0, open = false, ok = true, n = 0;
      for (var t = Date.UTC(y, 0, 1); t <= end; t += 864e5) {
        var iso = new Date(t).toISOString().slice(0, 10), a = pcpn(by[y][iso]);
        n++;
        if (!(iso in by[y]) || a.v === null) { ok = false; break; }
        if (a.f === 'S') open = true;
        else { if (open && a.f !== 'A') { ok = false; break; } open = false; }
        tot += a.v;
      }
      out[y] = { year: y, ok: ok && !open, total: Math.round(tot * 100) / 100, days: n };
    });
    return out;
  }
  function rankSoFar(rows, fig) {
    if (!fig || !fig.asOf) return { status: 'none', why: 'no rain record for this county this year' };
    if (!rows || !rows.length) return { status: 'none', why: 'the station record did not load' };
    var year = +fig.year, mmdd = String(fig.asOf).slice(5, 10);
    var w = windowTotals(rows, mmdd), me = w[year];
    var span = 'Jan 1 to ' + md(fig.asOf);
    if (!me || !me.ok) return { status: 'none', why: 'this year has a day with no report between Jan 1 and ' + md(fig.asOf) + ', so it is not ranked' };
    if (Math.abs(me.total - fig.total) > 0.011) return { status: 'none', why: 'NOAA’s record for this station now reads ' + me.total.toFixed(2) + ' in, not the ' + fig.total.toFixed(2) + ' in drawn; the county file will catch up on its next run' };
    var past = Object.keys(w).map(Number).filter(function (y) { return y < year; }).sort(function (a, b) { return a - b; });
    var full = past.filter(function (y) { return w[y].ok; }).map(function (y) { return w[y]; });
    var skipped = past.length - full.length;
    var n = full.length + 1;
    var base = { span: span, n: n, skipped: skipped, first: full.length ? full[0].year : null, last: full.length ? full[full.length - 1].year : null,
      total: me.total, years: full.map(function (f) { return [f.year, f.total]; }), soFar: !fig.done, min: RANK_MIN };
    if (n < RANK_MIN) { base.status = 'thin'; base.why = 'only ' + n + ' years with every day of ' + span + ' on record here; ranking needs ' + RANK_MIN; return base; }
    var lt = 0, gt = 0, eq = 0;
    full.forEach(function (f) { if (Math.abs(f.total - me.total) < 0.005) eq++; else if (f.total < me.total) lt++; else gt++; });
    var dry = lt <= gt;
    base.status = 'ok'; base.rank = (dry ? lt : gt) + 1; base.dir = dry ? 'driest' : 'wettest'; base.tied = eq; base.wetter = gt; base.drier = lt;
    return base;
  }
  /* "2026 at Cumberland: 9th wettest of 94 years so far (Jan 1 to Oct 13)." */
  function rankWordsRain(r, fig) {
    if (!r || r.status !== 'ok') return '';
    var which = r.rank === 1 ? 'the ' + r.dir : ordinal(r.rank) + ' ' + r.dir;
    return fig.year + ' at ' + fig.station.name + ': ' + (r.tied ? 'tied for ' : '') + which + ' of ' + r.n + ' years' + (r.soFar ? ' so far' : '') + ' (' + r.span + ').';
  }

  /* ── what is out of the ordinary here, against this place's own past (Oct 19) ──────
     THE RULE, SET BEFORE ANY COUNTY WAS RUN: a figure shows only when its newest value sits
     beyond 90% of the place's own earlier values (strictly higher than at least 90% of them, or
     strictly lower), with at least OWN_MIN earlier values, and the newest value is from this
     year or last year. Ties never count toward unusual. Figures with a steady climb (rent, land
     value, corn yield) are not checked: their newest value is nearly always a record, which
     says the trend, not the year. Five figures are checked, so in an ordinary year expect about
     one line here by chance (each two-sided check has about a 1 in 5 chance, drought 1 in 10);
     the math under each line says so. Nothing shows when nothing passes. */
  var OWN_MIN = 20, OWN_BAND = 0.9, OWN_MAX = 5, FULL_MAPS = 40;
  function ownLine(id, label, latest, earlier, opts) {
    if (!latest || latest.v == null || earlier.length < OWN_MIN) return { id: id, label: label, status: 'thin', n: earlier.length, latest: latest };
    var below = 0, above = 0;
    earlier.forEach(function (e) { if (e[1] < latest.v) below++; else if (e[1] > latest.v) above++; });
    var n = earlier.length, hi = below / n >= OWN_BAND, lo = !opts.highOnly && above / n >= OWN_BAND;
    return { id: id, label: label, status: hi || lo ? 'unusual' : 'ordinary', dir: hi ? 'high' : lo ? 'low' : null,
      latest: latest, n: n, below: below, above: above, from: earlier[0][0], to: earlier[n - 1][0], earlier: earlier,
      unit: opts.unit, source: opts.source, highOnly: !!opts.highOnly, partial: !!opts.partial };
  }
  function seriesOf(obj, pick) {
    return Object.keys(obj || {}).filter(function (y) { return /^\d{4}$/.test(y); }).map(Number).sort(function (a, b) { return a - b; })
      .map(function (y) { return [y, pick(obj[String(y)], y)]; }).filter(function (p) { return p[1] != null && isFinite(p[1]); });
  }
  function splitLatest(ser) { return ser.length ? { latest: { year: ser[ser.length - 1][0], v: ser[ser.length - 1][1] }, earlier: ser.slice(0, -1) } : { latest: null, earlier: [] }; }
  function ownPast(county, thisYear) {
    if (!county) return [];
    var out = [], recent = function (l) { return l && l.year >= thisYear - 1; };
    var cl = county.climate, ht = county.heat && county.heat.months, dr = county.drought, sob = county.sob;
    if (cl && cl.status === 'ok' && cl.gs_series) {
      var g = splitLatest(seriesOf(cl.gs_series, function (v) { return v; }));
      if (recent(g.latest)) out.push(ownLine('gs_rain', 'April to September rain', g.latest, g.earlier, { unit: 'in', source: 'NOAA nClimDiv county precipitation (newest months preliminary)' }));
    }
    [['jul', 'July'], ['aug', 'August']].forEach(function (mo) {
      var h = ht && ht[mo[0]];
      if (!h || !h.series) return;
      var s = splitLatest(seriesOf(h.series, function (v) { return v; }));
      if (recent(s.latest)) out.push(ownLine(mo[0] + '_nights', mo[1] + ' nights', s.latest, s.earlier, { unit: 'deg F', source: 'NOAA nClimDiv county minimum temperature' }));
    });
    if (dr && dr.status === 'ok' && dr.series) {
      var lf = dr.last_full_year;
      var fullYears = seriesOf(dr.series, function (v, y) { return v && v.maps >= FULL_MAPS && y <= lf && v.d2 != null ? v.d2 : null; });
      var py = dr.partial_year;
      if (py && py.year === thisYear && py.d2 != null) {
        out.push(ownLine('drought', 'Weeks in severe drought or worse', { year: py.year, v: py.d2, maps: py.maps }, fullYears, { unit: 'weeks', source: 'U.S. Drought Monitor county statistics', highOnly: true, partial: true }));
      } else if (fullYears.length) {
        var d = splitLatest(fullYears);
        if (recent(d.latest)) out.push(ownLine('drought', 'Weeks in severe drought or worse', d.latest, d.earlier, { unit: 'weeks', source: 'U.S. Drought Monitor county statistics' }));
      }
    }
    if (sob && sob.status === 'ok' && sob.per_year) {
      var lr = splitLatest(seriesOf(sob.per_year, function (v) { return v && !v.partial && v.ratio != null ? v.ratio : null; }));
      if (recent(lr.latest)) out.push(ownLine('loss_ratio', 'Crop insurance loss ratio', lr.latest, lr.earlier, { unit: 'paid out / premium', source: 'USDA RMA Summary of Business' }));
    }
    return out;
  }
  /* The lines that show (at most OWN_MAX, furthest out first), each one sentence. */
  function ownWords(l) {
    var y = l.latest.year, v = l.latest.v, n = l.n, span = l.from + ' to ' + l.to, k = l.dir === 'high' ? l.below : l.above;
    if (l.id === 'gs_rain') return 'April to September rain, ' + y + ': ' + v.toFixed(2) + ' in, ' + (l.dir === 'high' ? 'more' : 'less') + ' than in ' + k + ' of the ' + n + ' earlier years (' + span + ').';
    if (/_nights$/.test(l.id)) return l.label + ', ' + y + ': an average low of ' + v.toFixed(1) + '°F, ' + (l.dir === 'high' ? 'warmer' : 'cooler') + ' than ' + k + ' of the ' + n + ' earlier ' + l.label.split(' ')[0] + 's (' + span + ').';
    if (l.id === 'drought') return v + ' week' + (v === 1 ? '' : 's') + ' with at least half the county in severe drought or worse ' + (l.partial ? 'so far in ' + y + ', already more than in ' : 'in ' + y + ', ' + (l.dir === 'high' ? 'more' : 'fewer') + ' than in ') + k + ' of the ' + n + ' earlier full years (' + span + ').';
    if (l.id === 'loss_ratio') return 'Crop insurance paid out $' + v.toFixed(2) + ' per $1 of total premium (farmer and federal shares) in ' + y + ', ' + (l.dir === 'high' ? 'more' : 'less') + ' than in ' + k + ' of the ' + n + ' earlier years (' + span + ').';
    return l.label + ', ' + y + ': ' + v;
  }
  function unusualHere(county, thisYear) {
    return ownPast(county, thisYear).filter(function (l) { return l.status === 'unusual'; })
      .sort(function (a, b) { return Math.max(b.below, b.above) / b.n - Math.max(a.below, a.above) / a.n || 0; })
      .slice(0, OWN_MAX).map(function (l) { l.words = ownWords(l); return l; });
  }

  /* ── my elevator against its neighbors (Oct 19) ─────────────────────────────
     places: the bids network's live index (dnilgis/bids data/merged-index.json, `places`), whose
     rows carry the permanent elevId. A place's bid is its `now`: the nearest open delivery.
     THE RULE, SET BEFORE ANY PLACE WAS RUN:
       - the place's 3 nearest elevators within EL_NEAR miles that post a usable bid for the crop
         (US dollars, a basis within 300 cents, a cash price in the crop's bushel band)
       - its neighbors: every other elevator within EL_NB miles of IT posting the same crop for
         the same delivery period (one per elevId; the same id twice is one elevator)
       - at least EL_NB_MIN neighbors, else no comparison
       - the gap is its basis minus the neighbors' middle basis, in cents; nothing else */
  var EL_NEAR = 30, EL_NB = 40, EL_NB_MIN = 4, EL_EACH = 3;
  var BANDS = { corn: [2, 12], soybeans: [6, 32] };
  function elevBid(p, crop) {
    if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number' || (p.currency || 'USD') !== 'USD') return null;
    var n = p.now && p.now[crop];
    if (!n || typeof n.cash !== 'number' || typeof n.basisCents !== 'number' || Math.abs(n.basisCents) > 300) return null;
    if (!(n.cash >= BANDS[crop][0] && n.cash <= BANDS[crop][1])) return null;
    return { basis: Math.round(n.basisCents), cash: n.cash, period: String(n.period || ''), delivery: n.delivery || '' };
  }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), k = s.length;
    return k ? (k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2) : null;
  }
  function elevName(p) { return String(p.operator || '').trim(); }
  function elevTown(p) { return String(p.town || p.city || '').trim(); }
  function basisNeighbors(places, lat, lng, crops) {
    var out = {};
    if (!places || !places.length || lat == null || lng == null) return out;
    (crops || ['corn', 'soybeans']).forEach(function (crop) {
      var all = [];
      places.forEach(function (p) { var b = elevBid(p, crop); if (b) all.push({ p: p, b: b, id: p.elevId || ('place:' + p.place) }); });
      var mine = all.map(function (x) { return { x: x, mi: miles(lat, lng, x.p.lat, x.p.lon) }; })
        .filter(function (m) { return m.mi <= EL_NEAR; }).sort(function (a, b) { return a.mi - b.mi; });
      var seen = {}, rows = [];
      mine.forEach(function (m) {
        if (rows.length >= EL_EACH || seen[m.x.id]) return;
        seen[m.x.id] = 1;
        var nb = {}, list = [];
        all.forEach(function (o) {
          if (o.id === m.x.id || nb[o.id] || o.b.period !== m.x.b.period) return;
          var d = miles(m.x.p.lat, m.x.p.lon, o.p.lat, o.p.lon);
          if (d > EL_NB) return;
          nb[o.id] = 1;
          list.push({ basis: o.b.basis, name: elevName(o.p), town: elevTown(o.p), st: o.p.state || '', mi: Math.round(d) });
        });
        var r = { crop: crop, elevId: m.x.p.elevId || null, name: elevName(m.x.p), town: elevTown(m.x.p), st: m.x.p.state || '', mi: Math.round(m.mi),
          basis: m.x.b.basis, cash: m.x.b.cash, period: m.x.b.period, delivery: m.x.b.delivery, place: m.x.p.place || null, shard: m.x.p.shard || null,
          operator: m.x.p.operator || '', city: m.x.p.city || '', pricedAt: m.x.p.pricedAt || null, nbN: list.length, radius: EL_NB, min: EL_NB_MIN,
          neighbors: list.sort(function (a, b) { return a.basis - b.basis; }) };
        r.nbCos = Object.keys(list.reduce(function (o, l) { o[l.name.toLowerCase()] = 1; return o; }, {})).length;   // other branches of one company count too: said, not hidden
        if (list.length >= EL_NB_MIN) { r.nbMedian = median(list.map(function (l) { return l.basis; })); r.gap = r.basis - r.nbMedian; r.status = 'ok'; }
        else { r.status = 'thin'; r.why = (list.length ? 'only ' + list.length : 'no') + ' other elevator' + (list.length === 1 ? '' : 's') + ' within ' + EL_NB + ' miles post' + (list.length === 1 ? 's' : '') + ' ' + crop + ' for the same delivery; the comparison needs ' + EL_NB_MIN; }
        rows.push(r);
      });
      out[crop] = rows;
    });
    return out;
  }
  /* Its own recent history, from data/basis/<ST>.json (the /cash-bids "from -42c" line), joined
     on the permanent id: data/ids/basis-join.json gives the one history key an elevId holds
     (an id with two or more keys is left out there, never guessed). Mirrors cb-myelev.js
     basisFact(). HIST_DAYS: a row first seen fewer days ago than this says only that. */
  var HIST_DAYS = 28;
  function basisRowKey(fac, city, st, cat, sym, month) {
    var n = function (v) { return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' '); };
    return [n(fac), n(city), n(st), n(cat), n(sym), n(month)].join('|');
  }
  function basisHistMap(sh) {
    if (!sh || !sh.r) return null;
    var m = {}, f = sh.f || [], d = sh.d || [], c = sh.c || ['corn', 'soybeans', 'wheat', 'other'];
    var when = function (i) { return i == null || i >= d.length ? null : d[i]; };
    sh.r.forEach(function (r) {
      var fc = String(f[r[0]] || '').split('|');
      m[basisRowKey(fc[0], fc[1], sh.state, c[r[1]], r[2], r[3])] = { cur: r[4], prev: r[5], since: when(r[6]), first: when(r[7]), last: when(r[8]) };
    });
    return m;
  }
  function basisHistory(map, joinKey, crop, futuresMonth, delivery, live, today) {
    if (!map || !joinKey) return { status: 'none', why: 'no basis history joined to this elevator’s id' };
    var k = String(joinKey).split('|'), h = map[basisRowKey(k[1], k.slice(2).join('|'), k[0], crop, futuresMonth, delivery)];
    if (!h) return { status: 'none', why: 'no basis history for this contract and delivery' };
    var sane = function (c) { return c != null && Math.abs(c) <= 300; };
    if (live == null || !sane(live) || !sane(h.cur)) return { status: 'none', why: 'basis outside the range we narrate' };
    var age = h.first && today ? Math.round((Date.parse(today) - Date.parse(h.first)) / 864e5) : null;
    if (age == null || age < HIST_DAYS) return { status: 'thin', first: h.first, why: 'this delivery was first seen ' + md(h.first) + ' and we wait for ' + HIST_DAYS + ' days of it' };
    if (h.cur === live) {
      if (h.prev == null) return { status: 'ok', kind: 'same', first: h.first };
      return sane(h.prev) && h.since ? { status: 'ok', kind: 'moved', date: h.since, from: h.prev, first: h.first } : { status: 'none', why: 'the earlier value is outside the range we narrate' };
    }
    return h.last ? { status: 'ok', kind: 'after', date: h.last, from: h.cur, first: h.first } : { status: 'none', why: 'no last-seen day' };
  }

  /* ── Fast Facts rows (Oct 21, 2026) ───────────────────────────────
     One builder per number. The My place cards, the State tab and the US tab all
     call these, so a number reads the same wherever it shows. Each returns
     { label, value, ctx, date, src: [text, href] } or, when the number is missing,
     value null and why; join is what goes between the value and its line (". " unless set). No buyer, seller, elevator or co-op name ever goes in a row:
     the page is indexed. */
  var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var CROP_WORD = { corn: 'Corn', soybeans: 'Soybeans', wheat: 'Wheat' }, CROP_ADJ = { corn: 'Corn', soybeans: 'Soybean', wheat: 'Wheat' };
  function na(label, why, src) { return { label: label, value: null, why: why, src: src || null }; }
  function isoDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[0] : null; }
  function monDay(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MON3[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  function cents(c) { var a = Math.round(Math.abs(c) * 2) / 2; return (a % 1 ? a.toFixed(1) : String(a)) + '¢'; }
  /* "October delivery" from the bid's own delivery start (or "10/01/2026" or "Oct 01, 2026");
     an elevator's harvest code reads "harvest delivery"; plain words when it has no date. */
  var MON_I = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function deliveryWords(row) {
    var m = /^(\d{4})-(\d{2})/.exec(String(row && row.start || '')), t = String(row && row.delivery || '').trim();
    if (!m) { var d = /^(\d{2})\/\d{2}\/(\d{4})$/.exec(t); if (d) m = [0, d[2], d[1]]; }
    if (!m) { var e = /^([A-Za-z]{3})[a-z]*\.? \d{1,2},? (\d{4})$/.exec(t); if (e && MON_I[e[1].toLowerCase()]) m = [0, e[2], String(MON_I[e[1].toLowerCase()])]; }
    if (m && +m[2] >= 1 && +m[2] <= 12) return MONTHS_FULL[+m[2] - 1] + ' delivery';
    if (/^(har|harv|harvest)\b/i.test(t)) return 'harvest delivery';
    return /^[A-Za-z0-9 '\/.-]{1,24}$/.test(t) ? t + ' delivery' : '';
  }
  /* A bid row: the best price within BID_MILES, its miles and delivery, how many it beat, and the
     nearest elevator's price beside it. Never the buyer. paper: the source as it prints. */
  function factBid(o, crop, from, when, href) {
    var label = CROP_ADJ[crop] + ' bid';
    if (!o || !o.best) return na(label, 'no posted ' + crop + ' bid within ' + BID_MILES + ' mi of ' + from, ['See the bids near here', href]);
    var b = o.best, dw = deliveryWords(b), nb = o.nearest;
    var near = nb && nb !== b && (nb.mi !== b.mi || nb.price !== b.price) ? ' Nearest: $' + fixed(nb.price, 2) + ' at ' + nb.mi + ' mi.' : '';
    return { label: label, value: '$' + fixed(b.price, 2), date: isoDay(when), join: ', ',
      ctx: b.mi + ' mi from ' + from + (dw ? ', ' + dw : '') + '. ' + (o.n === 1 ? 'The only one within ' + BID_MILES + ' mi.' : 'Best of ' + o.n + ' within ' + BID_MILES + ' mi.') + near,
      src: ['See the bids near here', href], paper: 'Posted elevator bids' };
  }
  /* Cents in the market's own fractions: 2.25 -> "2¼¢" */
  function centsFrac(c) {
    var a = Math.abs(c), w = Math.floor(a + 1e-9), f = Math.round((a - w) * 8) / 8;
    var F = { 0: '', 0.125: '⅛', 0.25: '¼', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.75: '¾', 0.875: '⅞' };
    if (f === 1) { w++; f = 0; }
    return (w || !F[f] ? String(w) : '') + F[f] + '¢';
  }
  /* A futures row with its move from the last settle. px(cents, mode) is the site's one price formatter. */
  function factFutures(q, name, contract, href, px) {
    var label = name + ' futures';
    if (!q || typeof q.close !== 'number' || !px) return na(label, 'the price file did not load', ['Futures', href]);
    var settle = q.close_kind === 'settle';
    var range = q.wk52_lo != null && q.wk52_hi != null ? ' 52-week range ' + px(q.wk52_lo, 'down') + ' to ' + px(q.wk52_hi, 'up') + '.' : '';
    var ch = typeof q.netChange === 'number' && isFinite(q.netChange) && q.prev_date ? ' ' + (Math.abs(q.netChange) < 0.0625 ? 'Unchanged from' : (q.netChange > 0 ? 'Up ' : 'Down ') + centsFrac(q.netChange) + ' from') + ' the ' + monDay(q.prev_date).replace(/, \d{4}$/, '') + ' settle.' : '';
    return { label: label, value: px(q.close), date: isoDay(settle ? q.settle_date || q.close_date : q.close_date),
      ctx: (contract ? contract + ', ' : '') + (settle ? 'settle' : 'last trade, delayed') + '.' + ch + range, src: ['CBOT', href], paper: 'CBOT futures, delayed' };
  }
  /* Basis: the middle of the posted bids within BID_MILES of the reader when at least three post one
     (local: { median, n } from bestBids, dollars a bushel), else the state's middle; the state's middle
     and USDA's region against its normal follow in the line. */
  function factBasis(b, n, crop, st, href, local, from) {
    var label = CROP_ADJ[crop] + ' basis';
    if (!b || b.status !== 'ok') {
      if (!local || local.n < 3 || local.median == null) return na(label, b && b.why ? b.why : 'no state basis this week', ['Basis', href]);
    }
    var usda = n && n.status === 'ok' ? ' USDA ' + n.region + ' region: ' + (Math.abs(n.delta) < 0.0025 ? 'the same as' : cents(n.delta * 100) + ' ' + (n.delta < 0 ? 'weaker' : 'stronger') + ' than') + ' its 5-year normal for the week of ' + monDay(n.week).replace(/, \d{4}$/, '') + '.' : '';
    var ok = b && b.status === 'ok', lab = ok ? b.label : 'futures';
    function words(m) { return cents(m * 100) + ' ' + (m < 0 ? 'under' : 'over') + ' ' + lab; }
    if (local && local.n >= 3 && local.median != null) {
      return { label: label, value: words(local.median), date: isoDay(local.when) || (ok ? isoDay(b.asOf) : ''),
        ctx: 'Middle of ' + local.n + ' bids within ' + BID_MILES + ' mi of ' + (from || 'here') + '.' + (ok ? ' ' + STATES[st] + ': ' + words(b.median) + ', middle of ' + b.n + ' bids.' : '') + usda,
        src: ['Basis', href], paper: 'Posted elevator bids' + (usda ? '; USDA AgTransport' : '') };
    }
    return { label: label + ', ' + (STATES[st] || st), value: words(b.median), date: isoDay(b.asOf), ctx: 'Middle of ' + b.n + ' ' + STATES[st] + ' bids.' + usda, src: ['Basis', href], paper: 'Posted elevator bids' + (usda ? '; USDA AgTransport' : '') };
  }
  function factRain(r, href) {
    if (!r || r.status !== 'ok') return na('Rain since Jan 1', r && r.why ? r.why : 'no county rain record');
    var mo = r.month, thru = md(r.through), bits = [];
    bits.push(r.pct != null ? r.pct + '% of the ' + r.normals + ' normal (' + r.normal.toFixed(2) + ' in) for the same days.' : 'No normal for this date.');
    if (mo && mo.inches != null) bits.push(MONTHS_FULL[mo.i] + ' so far: ' + mo.inches.toFixed(2) + ' in' + (mo.usual != null ? ', usual ' + mo.usual.toFixed(2) + ' in' : '') + ' to ' + thru + '.');
    if (r.station && r.station.name) bits.push('Station: ' + r.station.name + ', ' + milesFrom(r.station.mi) + ' the county middle.');
    return { label: 'Rain since Jan 1', value: r.inches.toFixed(2) + ' in', date: isoDay(r.through), join: ', ', ctx: bits.join(' '), src: ['NOAA', href], paper: 'NOAA daily station record' };
  }
  /* Drought: the most severe category covering at least half the county (else the most severe
     present), "or worse", against four weeks earlier, and how many weekly maps in a row some part
     of the county has been in it. A bare count; FSA decides any program. */
  var DNAME = ['abnormally dry', 'moderate drought', 'severe drought', 'extreme drought', 'exceptional drought'];
  function factDrought(d) {
    if (!d || d.status !== 'ok') return na('Drought', d && d.why ? d.why : 'no Drought Monitor row', ['Drought map', '/drought-monitor']);
    var src = ['U.S. Drought Monitor', '/drought-monitor'];
    if (d.worst < 0) return { label: 'Drought', value: 'None', date: isoDay(d.valid), ctx: 'No part of the county dry or in drought.', src: src, paper: 'U.S. Drought Monitor' };
    var k = d.now[1] > 0 ? 1 : 0;
    for (var i = 4; i >= 1; i--) if (d.now[i] >= 50) { k = i; break; }
    var pct = Math.round(d.now[k]), was = d.fourAgo && d.fourAgo[k] != null ? Math.round(d.fourAgo[k]) : null;
    var bits = ['D' + k + ' is ' + DNAME[k] + '.'];
    if (k >= 1 && d.now[0] > d.now[k]) bits.push(Math.round(d.now[0]) + '% abnormally dry (D0) or worse.');
    if (d.worst > k && d.now[d.worst] > 0) bits.push(Math.round(d.now[d.worst]) + '% in D' + d.worst + ' (' + DNAME[d.worst] + ').');
    bits.push(was == null ? 'No map four weeks earlier.' : was === pct ? 'Same as four weeks ago.' : was + '% four weeks earlier.');
    var st = d.streak, wk = k >= 1 && st ? st[k - 1] : 0, lb = st && st[7] ? (st[7] >> (k - 1)) & 1 : 0;
    if (wk >= 2) bits.push('D' + k + ' or worse somewhere in the county ' + (lb ? 'at least ' : '') + wk + ' weeks in a row.');
    return { label: 'Drought', value: pct + '% in D' + k + ' or worse', date: isoDay(d.valid), ctx: bits.join(' '), src: src, paper: 'U.S. Drought Monitor' };
  }
  function factHail(h, at, href) {
    if (!h || h.status !== 'ok') return na('Hail, last 30 days', h && h.why ? h.why : 'no hail file', ['Hail map', href]);
    return { label: 'Hail, last ' + h.days + ' days', value: h.n ? h.n + ' report' + (h.n === 1 ? '' : 's') : 'None', date: isoDay(h.through),
      ctx: h.n ? 'Within ' + h.radius + ' mi of ' + at + '. Biggest ' + h.biggest.toFixed(2) + ' in, latest ' + monDay(h.latest.date).replace(/, \d{4}$/, '') + '.' : 'No report within ' + h.radius + ' mi of ' + at + '. A missing report is not proof of no hail.',
      src: ['NWS storm reports', href], paper: 'NWS storm reports' };
  }
  /* Crop progress: the state's row and the US row together (data/crop-progress.json). The 5-year
     figure is our average of the NASS weeks (the file's progress_method), and it says so. */
  function factProgress(file, st, crop) {
    var label = CROP_WORD[crop] + ' harvested', src = ['Crop progress', '/conditions'];
    if (!file) return na(label, 'the crop progress file did not load', src);
    var s = st && file.states && file.states[st] ? file.states[st][crop + '_harvested'] : null, u = file.progress ? file.progress[crop + '_harvested'] : null;
    s = s && s.pct != null ? s : null; u = u && u.pct != null ? u : null;
    if (!s && !u) return na(label, 'USDA reports no ' + crop + ' harvest this week', src);
    var name = st ? STATES[st] || st : '', parts = [], bits = [];
    if (s) parts.push(s.pct + '% ' + st);
    if (u) parts.push(u.pct + '% US');
    function line(r, w) { var x = []; if (r.prev_week != null) x.push(r.prev_week + '% a week earlier'); if (r.avg5 != null) x.push('5-year average ' + r.avg5 + '%'); return x.length ? w + ': ' + x.join('; ') + '.' : ''; }
    if (s) bits.push(line(s, name)); else if (st) bits.push('USDA does not report ' + name + ' this week.');
    if (u) bits.push(line(u, 'US'));
    var wk = (s || u).date;
    bits.push('Week ending ' + monDay(wk).replace(/, \d{4}$/, '') + '.' + (s && s.avg5 != null || u && u.avg5 != null ? ' The 5-year average is our average of the NASS weeks.' : ''));
    return { label: label, value: parts.join(', '), date: isoDay(wk), ctx: bits.filter(Boolean).join(' '), src: src, paper: 'USDA NASS Crop Progress' };
  }
  /* A source as it prints: agency plus year ("USDA Census of Agriculture, 2022"), never a data-set id. */
  function srcName(source, years) {
    var t = String(source || ''), y = String(years || ''), yr = (y.match(/\d{4}/g) || []).pop() || '';
    var agency = /Census of Agriculture/i.test(t) ? 'USDA Census of Agriculture' : /NASS/i.test(t) ? 'USDA NASS' : /RMA|Summary of Business/i.test(t) ? 'USDA RMA' :
      /FSA|CRP/i.test(t) ? 'USDA FSA' : /Drought Monitor/i.test(t) ? 'U.S. Drought Monitor' : /NOAA|NCEI|nClim/i.test(t) ? 'NOAA' : /USGS/i.test(t) && /USDA/i.test(t) ? 'USDA and USGS' :
      /USGS/i.test(t) ? 'USGS' : /EIA/i.test(t) ? 'U.S. Energy Information Administration' : /storm|NWS|SPC/i.test(t) ? 'NOAA storm reports' : t.replace(/\s*\(.*?\)\s*/g, ' ').trim();
    var span = /^\d{4}-\d{4}$/.test(y) || /^\d{4} to date$/.test(y) ? y : yr;
    return agency + (span ? ', ' + span : '');
  }
  /* A county figure from the profile (rent, land value, loss ratio): its value, its rank in the
     state; lead is a qualifier said first ("Non-irrigated cropland."). */
  function factCol(c, label, href, lead) {
    if (!c) return na(label, 'no such figure for this county');
    var src = c.source ? srcName(c.source, '') : 'Source';
    if (c.value == null) return na(label, c.reason || 'no figure in the source for this county', c.source ? [src, href] : null);
    var words = c.words ? c.words.charAt(0).toUpperCase() + c.words.slice(1) + '.' : '';
    return { label: label, value: c.unit === 'paid out / premium' ? '$' + fixed(c.value, 2) : fmt(c.value, c), date: c.year ? String(c.year) : c.years || '',
      ctx: [lead, words].filter(Boolean).join(' '), src: [src, href], paper: src };
  }
  /* The worst single year inside the loss ratio's span (Oct 22 panel, lender: "the worst recent years at
     a glance"), from the county's own RMA years: indemnity over total premium, every year of the span on
     file or nothing. { year, ratio } or null. */
  function lossWorst(county, years) {
    var s = county && county.sob, m = /^(\d{4})-(\d{4})$/.exec(String(years || '')), best = null;
    if (!s || s.status !== 'ok' || !s.per_year || !m) return null;
    for (var y = +m[1]; y <= +m[2]; y++) {
      var r = s.per_year[String(y)];
      if (!r || !(r.prem > 0) || r.indem == null) return null;
      var v = r.indem / r.prem;
      if (!best || v > best.ratio) best = { year: y, ratio: v };
    }
    return best;
  }
  /* Recorded farm sales: the Atlas sales tile (components/atlas-sales.js AtlasSales.tile), worded the same. */
  function factSales(t, st, href) {
    var label = 'Recorded farm sales';
    if (!t) return na(label, 'recorded sales are on hand for Illinois and Wisconsin only' + (st ? ', not ' + (STATES[st] || st) : ''));
    if (t.val == null) return na(label, t.sub, ['Deed records', href]);
    return { label: label, value: t.val + t.unit, date: isoDay(t.through), ctx: 'Median price per acre, ' + t.sub.replace(/; sales dated through .*$/, '') + '.', src: ['Deed records', href], paper: 'County deed records' };
  }
  /* ARC or PLC: where each sign-up stands on today's date in Central time (data/arc-plc.json);
     both crop years while both are open. */
  function factArcPlc(f, today, href) {
    var label = 'ARC or PLC sign-up', src = ['ARC or PLC', href];
    if (!f || !f.years) return na(label, 'the program file did not load', src);
    var ys = Object.keys(f.years).sort(), open = ys.filter(function (y) { var Y = f.years[y]; return Y.open && Y.close && today >= Y.open && today <= Y.close; });
    var dy = f.default_year || {}, main = String(open[0] || (dy.until && today > dy.until ? dy.then : (dy.before || ys[ys.length - 1]))), Y = f.years[main];
    if (!Y) return na(label, 'no ' + main + ' sign-up dates published yet', src);
    var ends = Y.close;   // the sign-up's last day (a date, not a market close)
    var v = today < Y.open ? 'Opens ' + monDay(Y.open) : today <= ends ? 'Open until ' + monDay(ends) : 'Sign-up ended ' + monDay(ends);
    var also = open.filter(function (y) { return y !== main; }).map(function (y) { var Z = f.years[y]; return ' ' + y + ' sign-up also open, ' + monDay(Z.open).replace(/, \d{4}$/, '') + ' to ' + monDay(Z.close) + '.'; }).join('');
    if (!also) ys.forEach(function (y) { var Z = f.years[y]; if (y > main && Z.open && today < Z.open) also += ' ' + y + ' sign-up opens ' + monDay(Z.open) + '.'; });
    return { label: label, value: v, long: true, date: isoDay(f.updated), ctx: main + ' crop year, at the county FSA office.' + also, src: src, paper: 'USDA FSA' };
  }
  /* The next event on the site's USDA calendar, in Central time. when: the time already worded. */
  function factUsda(r, when) {
    var label = 'Next on the USDA calendar';
    if (!r) return na(label, 'the report calendar did not load', ['USDA calendar', '/usda-calendar']);
    return { label: label, value: r.name, long: true, date: '', ctx: when + ' CT.', src: ['USDA calendar', '/usda-calendar'], paper: 'USDA report calendar' };
  }
  /* A posted fertilizer price. One co-op's price is never named: "one Kansas co-op". */
  function fertSrc(p, short) {
    if (!p) return '';
    if (p.src === 'coop' && p.n === 1) return 'one ' + (p.region ? p.region + ' ' : '') + 'co-op' + (p.as_of ? (short ? ', ' + monDay(p.as_of).replace(/, \d{4}$/, '') : ', posted ' + monDay(p.as_of)) : '');
    return short ? (p.short_label || p.src_label || '') : (p.src_label || p.short_label || '');
  }
  /* file: the price doc components/fert-pick.js chose for the place's state (the reader's own
     state's co-op sheets first, else every current sheet). Anhydrous, else urea; a product from
     the reader's own state comes first. Never a co-op's name; always the posting dates. */
  function factFert(file) {
    var list = ((file && file.prices) || []).filter(function (p) { return (p.key === 'anhydrous' || p.key === 'urea') && p.price > 0; });
    list.sort(function (a, b) { return (a.scope === 'state' ? 0 : 1) - (b.scope === 'state' ? 0 : 1) || (a.key === 'anhydrous' ? 0 : 1) - (b.key === 'anhydrous' ? 0 : 1); });
    var pick = list[0] || null;
    if (!pick) return na('Fertilizer', 'no current co-op price for anhydrous or urea', ['Fertilizer prices', '/fertilizer']);
    var where = pick.src === 'coop' && pick.n === 1 ? fertSrc(pick, false) : pick.src_label || '';
    return { label: pick.name, value: '$' + fixed(Math.round(pick.price), 0) + ' a ton', date: isoDay(pick.as_of || file.updated),
      ctx: (where ? where.charAt(0).toUpperCase() + where.slice(1) + '. ' : '') + 'Cash price; call to confirm.', src: ['Fertilizer prices', '/fertilizer'], paper: 'Co-op posted prices' };
  }
  /* The Daily: this morning's teaser, with no price of its own (the futures rows carry the price,
     with the time; the letter's prices are from before the open). */
  function factDaily(d) {
    var label = 'This morning’s Daily';
    if (!d || !(d.teaser || d.headline)) return na(label, 'the briefing did not load', ['Read the Daily', '/daily']);
    /* A teaser that carries a dollar figure (Oct 22: "crude climbs 2.2% to $99.24") is a price from
       before the open, so the row says the letter is out and the link carries the rest. */
    var t = d.teaser || d.headline, priced = /\$\d/.test(t);
    return { label: label, value: priced ? 'Out this morning' : t, date: isoDay(d.generated_at) || d.date || '', ctx: priced ? 'Its prices are from before the open; the futures rows have the latest.' : '', src: ['Read the Daily', '/daily'], long: !priced };
  }
  /* State pages a link can open, for all 50 states. A state left out has no such page;
     test/fast-facts-front.test.mjs checks every link on disk. Cash bids come from
     data/basis-states.json (its path is the page). */
  var NO_PAGE = { rent: 'AK HI RI', prf: 'AK HI', yield: 'AK CT HI ME MA NH RI VT', arc: 'HI' };
  function stateLinks(st, basisFile) {
    if (!STATES[st]) return [];
    var s = stSlug(st), n = STATES[st], out = [];
    function has(k) { return (' ' + NO_PAGE[k] + ' ').indexOf(' ' + st + ' ') < 0; }
    var b = basisFile && basisFile.states && basisFile.states[st];
    if (b && b.path) out.push({ id: 'bids', href: b.path.split('#')[0], text: 'Cash bids in ' + n });
    out.push({ id: 'rain', href: '/rain/' + s, text: 'Rain by county' });
    if (has('rent')) out.push({ id: 'rent', href: '/rent/' + s, text: n + ' cash rent' });
    out.push({ id: 'atlas', href: '/farmland-atlas/' + s + '/', text: 'Farmland Atlas' });
    if (has('arc')) out.push({ id: 'arc', href: '/arc-plc/' + s, text: 'ARC or PLC by county' });
    if (has('prf')) out.push({ id: 'prf', href: '/prf/' + s, text: 'PRF pasture insurance' });
    if (has('yield')) out.push({ id: 'yield', href: '/yield/' + s, text: 'Yield by county' });
    return out;
  }

  return {
    factBid: factBid, factFutures: factFutures, factBasis: factBasis, factRain: factRain, factDrought: factDrought, factHail: factHail,
    factProgress: factProgress, factCol: factCol, factSales: factSales, factArcPlc: factArcPlc, factUsda: factUsda, factFert: factFert,
    factDaily: factDaily, fertSrc: fertSrc, srcName: srcName, centsFrac: centsFrac, deliveryWords: deliveryWords, stateLinks: stateLinks, NO_PAGE: NO_PAGE,
    rainFigure: rainFigure, rainChart: rainChart, rankSoFar: rankSoFar, rankWordsRain: rankWordsRain, windowTotals: windowTotals, RANK_MIN: RANK_MIN,
    ownPast: ownPast, unusualHere: unusualHere, ownWords: ownWords, OWN_MIN: OWN_MIN, OWN_MAX: OWN_MAX,
    basisNeighbors: basisNeighbors, basisHistMap: basisHistMap, basisHistory: basisHistory, median: median, EL: { NEAR: EL_NEAR, NB: EL_NB, NB_MIN: EL_NB_MIN, EACH: EL_EACH, HIST_DAYS: HIST_DAYS },
    milesFrom: milesFrom,
    SECTIONS: SECTIONS, PRINT_PARTS: PRINT_PARTS, STATES: STATES, FIPS_ST: FIPS_ST, MIN_RANK_N: MIN_RANK_N,
    deeper: deeper, parsePrint: parsePrint, printParam: printParam, printCode: printCode, printFromCode: printFromCode, qrLink: qrLink, parseQuery: parseQuery, parsePoint: parsePoint, classify: classify,
    splitState: splitState, normName: normName, stateFromName: stateFromName, findCounty: findCounty,
    countyInState: countyInState, countyAt: countyAt, stateOf: stateOf, rankIn: rankIn, profile: profile,
    sentence: sentence, fmt: fmt, fmtShort: fmtShort, lossWorst: lossWorst, ordinal: ordinal, miles: miles, rainSoFar: rainSoFar,
    droughtNow: droughtNow, hailNear: hailNear, basisVsNormal: basisVsNormal, stateBasis: stateBasis,
    bestBids: bestBids, nextReport: nextReport, longView: longView, stSlug: stSlug
  };
});
