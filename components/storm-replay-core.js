/* storm-replay-core.js: the math and the words behind the storm replay
 * (components/storm-replay.js draws it on /hail-map and /rain-radar).
 * No DOM here, so node can test every number the caption prints:
 * frame times, the share link, which source frame goes with which clock
 * time, hail at the field, reports near it, lightning counts, and the
 * sentence a farmer reads. Loaded only when a reader opens a replay.
 *
 * Every number carries what it is. A radar hail size is an estimate. A hail
 * report is something a person saw (observed). Radar rain is an estimate.
 * Lightning here is worked from NOAA's 15-minute density grid, an estimate
 * of strikes, not a count of each flash. Nothing is filled in: a missing
 * source says it is missing. */
(function (root) {
  'use strict';

  var MIN = 60e3, HOUR = 3600e3;
  var RADAR_LAG_MIN = 10;          // the national radar mosaic posts a few minutes after its time
  var HOURS_STALE_H = 3;           // hourly hail file older than this: say so
  var NEAR_HAIL_MI = 3;            // "near your field" for a radar hail band
  var REPORT_MI = 10;              // hail reports this close count
  var LIGHTNING_CELL_KM = 8;       // NOAA's lightning density grid is about 8 km
  var LIGHTNING_PERIOD_MIN = 15;   // each density map covers 15 minutes
  var LAYERS = ['radar', 'lightning', 'swaths', 'reports', 'clouds'];
  var LAYER_KEY = { radar: 'r', lightning: 'l', swaths: 's', reports: 'p', clouds: 'c' };
  var DEFAULT_LAYERS = { radar: true, lightning: true, swaths: true, reports: true, clouds: false };

  /* On-screen credit for every source the replay can show. test/storm-replay.test.mjs
     checks each layer has one and the browser test checks they are on screen. */
  var CREDITS = {
    radar: { name: 'NOAA radar', what: 'NWS NEXRAD radar mosaic (base reflectivity), map tiles from the Iowa Environmental Mesonet, Iowa State University', url: 'https://mesonet.agron.iastate.edu/ogc/' },
    lightning: { name: 'NOAA lightning', what: 'NOAA/NWS nowCOAST lightning strike density, derived from Vaisala NLDN/GLD360', url: 'https://nowcoast.noaa.gov/' },
    clouds: { name: 'NOAA satellite', what: 'NOAA nowCOAST, GOES East/West infrared (NOAA NESDIS)', url: 'https://nowcoast.noaa.gov/' },
    swaths: { name: 'Radar hail estimate', what: 'NOAA MRMS MESH, hour by hour, via Iowa State mtarchive, drawn by AGSIST', url: '/hail-map' },
    reports: { name: 'NWS hail reports', what: 'National Weather Service Local Storm Reports via the Iowa Environmental Mesonet', url: 'https://mesonet.agron.iastate.edu/lsr/' },
    rain: { name: 'Radar rain total', what: 'NOAA MRMS multi-sensor rain (radar and gauges), 24-hour total, read by AGSIST', url: '/rain-radar' },
    map: { name: 'Map', what: 'USGS The National Map', url: 'https://www.usgs.gov/programs/national-geospatial-program/national-map' }
  };

  /* ---------- the clock ---------- */
  function windowSpec(h) { return +h === 48 ? { hours: 48, step: 30 } : { hours: 24, step: 15 }; }
  function snapDown(ms, stepMin) { var s = stepMin * MIN; return Math.floor(ms / s) * s; }
  function latestEnd(nowMs, stepMin) { return snapDown(nowMs - RADAR_LAG_MIN * MIN, stepMin); }
  /* every frame from end - hours to end, both ends in, oldest first */
  function frameTimes(endMs, hours, stepMin) {
    var n = Math.round(hours * 60 / stepMin), out = [];
    for (var i = n; i >= 0; i--) out.push(endMs - i * stepMin * MIN);
    return out;
  }
  function nearestIndex(times, t) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < times.length; i++) { var d = Math.abs(times[i] - t); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes());
  }
  function parseStamp(s) {
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return isNaN(t) || new Date(t).getUTCMonth() !== +m[2] - 1 ? null : t;
  }
  function isoMin(ms) { return new Date(ms).toISOString().slice(0, 16) + 'Z'; }

  /* NOAA's national radar mosaic at one time (every 5 minutes, archived years back) */
  function radarTileUrl(ms) {
    return 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-' + stamp(snapDown(ms, 5)) + '/{z}/{x}/{y}.png';
  }
  function lsrUrl(startMs, endMs, lat, lon) {
    return 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson?sts=' + isoMin(startMs) + '&ets=' + isoMin(endMs) +
      '&north=' + (lat + 1.5).toFixed(2) + '&south=' + (lat - 1.5).toFixed(2) + '&east=' + (lon + 2).toFixed(2) + '&west=' + (lon - 2).toFixed(2);
  }
  var NOWCOAST = 'https://nowcoast.noaa.gov/geoserver/observations/';
  var WMS = {
    lightning: { service: 'lightning_detection', layer: 'ldn_lightning_strike_density', before: 15, after: 2 },
    clouds: { service: 'satellite', layer: 'goes_longwave_imagery', before: 20, after: 2 }
  };
  function capsUrl(kind) { return NOWCOAST + WMS[kind].service + '/ows?service=WMS&version=1.3.0&request=GetCapabilities'; }
  function wmsUrl(kind) { return NOWCOAST + WMS[kind].service + '/ows'; }
  /* one cell's value at the field, for the lightning count */
  function featureInfoUrl(kind, lat, lon, iso) {
    var d = 0.05, w = WMS[kind];
    return wmsUrl(kind) + '?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=' + w.layer + '&query_layers=' + w.layer +
      '&styles=&crs=EPSG:4326&bbox=' + [(lat - d).toFixed(4), (lon - d).toFixed(4), (lat + d).toFixed(4), (lon + d).toFixed(4)].join(',') +
      '&width=3&height=3&i=1&j=1&info_format=application/json&time=' + encodeURIComponent(iso);
  }

  /* ---------- NOAA's advertised times ---------- */
  function isoDur(s) {
    var m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || '').trim());
    if (!m) return 0;
    return (((+m[1] || 0) * 24 + (+m[2] || 0)) * 60 + (+m[3] || 0)) * MIN + (+m[4] || 0) * 1000;
  }
  /* "t1,t2,..." or "start/end/PT15M" (or a mix); sorted, deduped, at most 2,000 */
  function parseTimeDimension(text) {
    var out = [];
    String(text || '').split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var bits = part.split('/');
      if (bits.length === 3) {
        var a = Date.parse(bits[0]), b = Date.parse(bits[1]), p = isoDur(bits[2]);
        if (isNaN(a) || isNaN(b) || !(p > 0) || b < a) return;
        for (var t = a; t <= b && out.length < 4000; t += p) out.push(t);
      } else {
        var t1 = Date.parse(part);
        if (!isNaN(t1)) out.push(t1);
      }
    });
    out.sort(function (x, y) { return x - y; });
    var u = [];
    for (var i = 0; i < out.length; i++) if (!u.length || u[u.length - 1] !== out[i]) u.push(out[i]);
    return u.slice(-2000);
  }
  /* the time list of one named layer in a WMS GetCapabilities document; null if absent */
  function capsTimes(xml, layer) {
    xml = String(xml || '');
    var re = new RegExp('<(?:\\w+:)?Name>\\s*' + layer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*</(?:\\w+:)?Name>');
    var m = re.exec(xml);
    if (!m) return null;
    var rest = xml.slice(m.index);
    var stop = rest.search(/<(?:\w+:)?Layer[\s>]|<\/(?:\w+:)?Layer>/);
    if (stop > 0) rest = rest.slice(0, stop);
    var d = /<(?:\w+:)?(?:Dimension|Extent)\b[^>]*name\s*=\s*["']time["'][^>]*>([^<]*)</i.exec(rest);
    return d ? parseTimeDimension(d[1]) : null;
  }
  /* the newest advertised time within [t - before, t + after]; null if none */
  function matchTime(times, t, beforeMin, afterMin) {
    var best = null;
    for (var i = 0; i < (times || []).length; i++) {
      var x = times[i];
      if (x >= t - beforeMin * MIN && x <= t + afterMin * MIN && (best == null || x > best)) best = x;
    }
    return best;
  }

  /* ---------- the share link ---------- */
  function layerString(layers) {
    return LAYERS.filter(function (k) { return layers && layers[k]; }).map(function (k) { return LAYER_KEY[k]; }).join('');
  }
  function parseLayers(s) {
    if (typeof s !== 'string' || !/^[rlspc]*$/.test(s)) return Object.assign({}, DEFAULT_LAYERS);
    var o = {};
    LAYERS.forEach(function (k) { o[k] = s.indexOf(LAYER_KEY[k]) >= 0; });
    return o;
  }
  /* view: {lat, lon, label, hours, end, frame, layers}. Returns "?sr=1&..." */
  function encodeShare(v) {
    var q = ['sr=1', 'la=' + (+v.lat).toFixed(4), 'lo=' + (+v.lon).toFixed(4)];
    if (v.label) q.push('n=' + encodeURIComponent(String(v.label).slice(0, 60)));
    q.push('h=' + windowSpec(v.hours).hours, 'e=' + stamp(v.end), 'f=' + stamp(v.frame), 'ly=' + layerString(v.layers));
    return '?' + q.join('&');
  }
  /* back from a query string; null when it is not a replay link or the spot is bad.
     A bad end or frame falls back to the latest replay; a frame off the grid snaps to the nearest one. */
  function decodeShare(search, nowMs) {
    var q;
    try { q = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch (e) { return null; }
    if (q.get('sr') !== '1') return null;
    var lat = parseFloat(q.get('la')), lon = parseFloat(q.get('lo'));
    if (!(isFinite(lat) && isFinite(lon) && lat > 15 && lat < 72 && lon > -180 && lon < -50)) return null;
    var spec = windowSpec(q.get('h'));
    var end = parseStamp(q.get('e')), latest = latestEnd(nowMs, spec.step);
    var live = !(end != null && end <= latest + spec.step * MIN);
    if (live) end = latest; else end = snapDown(end, spec.step);
    var times = frameTimes(end, spec.hours, spec.step);
    var f = parseStamp(q.get('f'));
    var frame = f == null || live ? end : times[nearestIndex(times, f)];
    var label = q.get('n');
    return { lat: lat, lon: lon, label: label ? label.slice(0, 60) : null, hours: spec.hours, step: spec.step,
             end: end, frame: frame, layers: parseLayers(q.get('ly')), live: live };
  }

  /* ---------- geometry ---------- */
  function miles(lat1, lon1, lat2, lon2) {
    var R = 3958.8, t = Math.PI / 180, dLat = (lat2 - lat1) * t, dLon = (lon2 - lon1) * t;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing8(lat1, lon1, lat2, lon2) {
    var t = Math.PI / 180, y = Math.sin((lon2 - lon1) * t) * Math.cos(lat2 * t);
    var x = Math.cos(lat1 * t) * Math.sin(lat2 * t) - Math.sin(lat1 * t) * Math.cos(lat2 * t) * Math.cos((lon2 - lon1) * t);
    var b = (Math.atan2(y, x) / t + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8];
  }
  function polys(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    return [];
  }
  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  /* even-odd across a polygon's rings, so a hole stays a hole */
  function inGeom(lat, lon, geom) {
    return polys(geom).some(function (p) {
      var n = 0;
      p.forEach(function (r) { if (inRing(lon, lat, r)) n++; });
      return n % 2 === 1;
    });
  }
  /* miles from the point to the nearest edge of the shape; 0 inside */
  function distToGeomMi(lat, lon, geom) {
    if (inGeom(lat, lon, geom)) return 0;
    var kx = 69.17 * Math.cos(lat * Math.PI / 180), ky = 69.17, best = Infinity;
    polys(geom).forEach(function (p) {
      p.forEach(function (r) {
        for (var i = 1; i < r.length; i++) {
          var ax = (r[i - 1][0] - lon) * kx, ay = (r[i - 1][1] - lat) * ky, bx = (r[i][0] - lon) * kx, by = (r[i][1] - lat) * ky;
          var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
          var s = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
          var px = ax + s * dx, py = ay + s * dy, d = Math.sqrt(px * px + py * py);
          if (d < best) best = d;
        }
      });
    });
    return best;
  }

  /* ---------- our data at the field ---------- */
  /* hours.json -> the hours in (start, end] with a radar hail band at or near the field */
  function hailHours(doc, lat, lon, startMs, endMs, nearMi) {
    nearMi = nearMi == null ? NEAR_HAIL_MI : nearMi;
    var out = [];
    ((doc && doc.hours) || []).forEach(function (h) {
      var e = Date.parse(h.end);
      if (!(e > startMs && e - HOUR < endMs)) return;
      var best = null;
      (h.features || []).forEach(function (f) {
        var t = f.properties && +f.properties.thresh_in;
        if (!(t > 0)) return;
        var d = distToGeomMi(lat, lon, f.geometry);
        if (d > nearMi) return;
        if (!best || t > best.maxIn || (t === best.maxIn && d < best.mi)) best = { maxIn: t, mi: d };
        if (d === 0) best.onField = true;
      });
      if (best) out.push({ end: e, start: e - HOUR, maxIn: best.maxIn, mi: best.mi, onField: !!best.onField || best.mi === 0 });
    });
    out.sort(function (a, b) { return a.end - b.end; });
    return out;
  }
  /* which hours the file holds for the window, and which it does not */
  function hoursCoverage(doc, startMs, endMs) {
    var have = {}, n = 0, need = 0;
    ((doc && doc.hours) || []).forEach(function (h) { have[Date.parse(h.end)] = 1; });
    for (var e = Math.floor(startMs / HOUR) * HOUR + HOUR; e <= endMs; e += HOUR) { need++; if (have[e]) n++; }
    return { read: n, need: need };
  }
  /* the daily swath file (no clock), for windows older than the hourly file keeps */
  function dailyHail(fc, lat, lon, nearMi) {
    nearMi = nearMi == null ? NEAR_HAIL_MI : nearMi;
    var best = null;
    ((fc && fc.features) || []).forEach(function (f) {
      var t = f.properties && +f.properties.thresh_in, d = distToGeomMi(lat, lon, f.geometry);
      if (t > 0 && d <= nearMi && (!best || t > best.maxIn)) best = { maxIn: t, mi: d, onField: d === 0 };
    });
    return best;
  }
  function lsrHail(fc, lat, lon, startMs, endMs, mi) {
    mi = mi == null ? REPORT_MI : mi;
    var out = [];
    ((fc && fc.features) || []).forEach(function (f) {
      var p = f.properties || {}, g = f.geometry;
      if (!g || g.type !== 'Point' || !/hail/i.test(String(p.typetext || p.type || ''))) return;
      var v = String(p.valid || p.utc_valid || '');
      var t = Date.parse(v + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));
      if (isNaN(t) || t <= startMs || t > endMs) return;
      var rl = g.coordinates[1], ro = g.coordinates[0], d = miles(lat, lon, rl, ro);
      if (d > mi) return;
      var mag = parseFloat(p.magnitude);
      out.push({ t: t, mag: mag > 0 && mag <= 8 ? mag : null, mi: d, dir: bearing8(lat, lon, rl, ro), city: p.city || '', st: p.st || p.state || '', lat: rl, lon: ro });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }
  /* density readings [{t, v}] (v null = not read) -> strikes in the field's cell */
  function lightningStrikes(readings, cellKm, periodMin) {
    cellKm = cellKm || LIGHTNING_CELL_KM; periodMin = periodMin || LIGHTNING_PERIOD_MIN;
    var sum = 0, read = 0, peak = null;
    (readings || []).forEach(function (r) {
      if (r.v == null || !isFinite(r.v)) return;
      read++;
      var n = Math.max(0, r.v) * 1e-3 * periodMin * cellKm * cellKm;
      sum += n;
      if (n > 0 && (!peak || n > peak.n)) peak = { t: r.t, n: n };
    });
    return { strikes: Math.round(sum), read: read, total: (readings || []).length, peak: peak };
  }
  /* the one number in a GetFeatureInfo answer; null when it is not a single value */
  function featureInfoValue(j) {
    var f = j && j.features && j.features[0];
    if (!j || !j.features) return null;
    if (!f) return 0; // no feature at the point: no lightning there
    var p = f.properties || {}, keys = Object.keys(p).filter(function (k) { return typeof p[k] === 'number' || /^-?\d+(\.\d+)?$/.test(String(p[k])); });
    if (keys.length !== 1) return null;
    var v = +p[keys[0]];
    return v < 0 || v > 1e6 ? 0 : v;
  }

  /* ---------- words ---------- */
  function clock(ms, tz) {
    var o = { hour: 'numeric', minute: '2-digit' };
    if (tz) o.timeZone = tz;
    var c = new Intl.DateTimeFormat('en-US', o).format(new Date(ms)).replace(/\u202f/g, ' ');
    if (c === '12:00 AM') return 'midnight';
    if (c === '12:00 PM') return 'noon';
    return c.replace(':00', '');
  }
  function dayKey(ms, tz) {
    var o = { year: 'numeric', month: '2-digit', day: '2-digit' };
    if (tz) o.timeZone = tz;
    return new Intl.DateTimeFormat('en-US', o).format(new Date(ms));
  }
  function weekday(ms, tz) {
    var o = { weekday: 'short' };
    if (tz) o.timeZone = tz;
    return new Intl.DateTimeFormat('en-US', o).format(new Date(ms));
  }
  /* "9:40 PM", with the weekday when it is not the same day as ref */
  function when(ms, tz, refMs) {
    var c = clock(ms, tz);
    return refMs != null && dayKey(ms, tz) !== dayKey(refMs, tz) ? weekday(ms, tz) + ' ' + c : c;
  }
  /* "9 to 11 PM", "Tue 9 to 11 PM", "Mon 11 PM to Tue 1 AM", "10 PM to midnight".
     A span that ends at midnight belongs to the day it ends. */
  function span(a, b, tz, refMs) {
    var ca = clock(a, tz), cb = clock(b, tz);
    var da = dayKey(a, tz), db = dayKey(b - 1000, tz), same = da === db;
    var ma = /( [AP]M)$/.exec(ca), mb = /( [AP]M)$/.exec(cb);
    if (same && ma && mb && ma[1] === mb[1]) ca = ca.slice(0, -3);
    var pa = (refMs != null && da !== dayKey(refMs, tz)) || !same ? weekday(a, tz) + ' ' : '';
    var pb = same ? '' : weekday(b, tz) + ' ';
    return pa + ca + ' to ' + pb + cb;
  }
  function tzName(ms, tz) {
    try {
      var o = { timeZoneName: 'short' };
      if (tz) o.timeZone = tz;
      var p = new Intl.DateTimeFormat('en-US', o).formatToParts(new Date(ms));
      for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') return p[i].value;
    } catch (e) {}
    return '';
  }
  function frameLabel(ms, tz) {
    var o = { weekday: 'short', month: 'short', day: 'numeric' };
    if (tz) o.timeZone = tz;
    return new Intl.DateTimeFormat('en-US', o).format(new Date(ms)) + ', ' + clock(ms, tz);
  }
  function hailIn(v) { return (Math.round(v * 100) / 100).toString().replace(/^0\./, '0.') + ' in'; }
  function rainIn(hundredths) { return (hundredths / 100).toFixed(2) + ' in'; }
  function miTxt(m) { return m < 1 ? 'under a mile' : Math.round(m) + (Math.round(m) === 1 ? ' mile' : ' mi'); }

  /* The replay's caption. in: {start, end, tz, hail: {hours, coverage, daily, ok}, reports: {list, ok},
     rain: {v, start, end, ok}, lightning: {strikes, read, total, ok}}. Each part is left out when its
     source did not answer; the source list says why. */
  function caption(inp) {
    var tz = inp.tz, ref = inp.end, lines = [], head = [];
    var hail = inp.hail || {}, rep = inp.reports || {}, rain = inp.rain || {}, lit = inp.lightning || {};
    // radar hail (estimate)
    if (hail.ok && hail.hours && hail.hours.length) {
      var hs = hail.hours, on = hs.filter(function (h) { return h.onField; });
      var use = on.length ? on : hs, mx = 0, mi = Infinity;
      use.forEach(function (h) { mx = Math.max(mx, h.maxIn); mi = Math.min(mi, h.mi); });
      var tspan = span(use[0].start, use[use.length - 1].end, tz, ref);
      if (on.length) {
        head.push('Hail estimated at your field ' + tspan);
        lines.push({ kind: 'hail', tag: 'estimate', text: 'Radar estimated hail at your field ' + tspan + ', up to ' + hailIn(mx) + '. Radar tends to run large next to stones on the ground.' });
      } else {
        head.push('Hail estimated near your field ' + tspan);
        lines.push({ kind: 'hail', tag: 'estimate', text: 'Radar estimated hail ' + miTxt(mi) + ' from your field ' + tspan + ', up to ' + hailIn(mx) + ', but not over the field itself.' });
      }
    } else if (hail.ok && hail.daily) {
      var dd = hail.daily;
      head.push('Hail estimated ' + (dd.onField ? 'at' : 'near') + ' your field');
      lines.push({ kind: 'hail', tag: 'estimate', text: 'Radar estimated hail ' + (dd.onField ? 'at your field' : miTxt(dd.mi) + ' from your field') + ' that day, up to ' + hailIn(dd.maxIn) + '. ' + (hail.why === 'old' ? 'The hour-by-hour file keeps 2 days' : 'The hour-by-hour estimate is not on file for this window') + ', so the time of day is not known here.' });
    } else if (hail.ok) {
      lines.push({ kind: 'hail', tag: 'estimate', text: 'No radar-estimated hail within ' + NEAR_HAIL_MI + ' miles of your field' + (hail.coverage && hail.coverage.read < hail.coverage.need ? ' in the ' + hail.coverage.read + ' of ' + hail.coverage.need + ' hours on file.' : ' in this window.') });
    }
    // hail reports (observed)
    if (rep.ok) {
      var L = rep.list || [];
      if (L.length) {
        var big = null;
        L.forEach(function (r) { if (r.mag != null && (!big || r.mag > big.mag)) big = r; });
        var first = L[0];
        var t = L.length === 1
          ? 'Hail reported ' + (first.mag != null ? hailIn(first.mag) + ', ' : '') + miTxt(first.mi) + ' ' + first.dir + (first.city ? ' (' + first.city + ')' : '') + ', ' + when(first.t, tz, ref) + '.'
          : L.length + ' hail reports within ' + REPORT_MI + ' miles, ' + span(L[0].t, L[L.length - 1].t, tz, ref) + (big ? '; largest ' + hailIn(big.mag) + ', ' + miTxt(big.mi) + ' ' + big.dir + (big.city ? ' (' + big.city + ')' : '') + ', ' + when(big.t, tz, ref) : '') + '.';
        lines.push({ kind: 'reports', tag: 'observed', text: t + ' Someone saw it and told the National Weather Service.' });
        if (!head.length) head.push('Hail reported ' + miTxt(first.mi) + ' ' + first.dir + ' of your field, ' + when(first.t, tz, ref) + ' (observed)');
      } else {
        lines.push({ kind: 'reports', tag: 'observed', text: 'No hail reported to the National Weather Service within ' + REPORT_MI + ' miles. Quiet can mean nobody called it in.' });
      }
    }
    // rain (estimate)
    if (rain.ok && rain.v != null) {
      var rtxt = rainIn(rain.v);
      var rw = span(rain.start, rain.end, tz, ref);
      head.push(rtxt + ' of rain (estimated)');
      lines.push({ kind: 'rain', tag: 'estimate', text: rtxt + ' of rain at your field, ' + rw + ' (NOAA radar and gauges, for the radar square your field is in, about 2 by 3 miles).' });
    }
    // lightning (estimate from density)
    if (lit.ok && lit.read) {
      var part = lit.read < lit.total;
      var n = lit.strikes;
      if (n > 0) {
        head.push((part ? 'at least ' : 'about ') + n + ' lightning strike' + (n === 1 ? '' : 's') + ' near your field (estimated)');
        lines.push({ kind: 'lightning', tag: 'estimate', text: (part ? 'At least ' : 'About ') + n + ' lightning strike' + (n === 1 ? '' : 's') + ' in the 5-mile square your field sits in' +
          (lit.peak ? ', most around ' + when(lit.peak.t, tz, ref) : '') + '. Worked from NOAA\u2019s 15-minute lightning density' + (part ? '; ' + (lit.total - lit.read) + ' of ' + lit.total + ' maps could not be read.' : '.') });
      } else {
        lines.push({ kind: 'lightning', tag: 'estimate', text: 'No lightning in the 5-mile square your field sits in' + (part ? ' on the ' + lit.read + ' of ' + lit.total + ' maps NOAA had.' : '.') });
      }
    }
    var headline = head.length ? head.join('; ') + '.'
      : (hail.ok && rep.ok) ? 'Quiet at your field: no radar-estimated hail and no hail reports.'
      : 'The storm sources did not answer, so there is nothing to say yet about your field.';
    return { headline: headline.charAt(0).toUpperCase() + headline.slice(1), lines: lines };
  }

  /* One line per source, said plainly, never blank.
     s: {id, state: ok|down|stale|short|partial|off|old|outside, since, oldest, newest, missing} */
  function sourceLine(s, tz, refMs) {
    var name = (CREDITS[s.id] || { name: s.id }).name;
    var w = function (t) { return when(t, tz, refMs); };
    switch (s.state) {
      case 'ok': return name + ': ' + (s.newest ? 'up to ' + w(s.newest) + '.' : 'loaded.');
      case 'loading': return name + ': loading.';
      case 'down': return s.since ? name + ' not answering since ' + w(s.since) + '.' : name + ' not answering right now.';
      case 'stale': return name + ' has not updated since ' + w(s.since) + '.';
      case 'short': return name + ' only goes back to ' + w(s.oldest) + '; earlier frames have no ' + (s.id === 'lightning' ? 'lightning' : 'satellite') + ' layer.';
      case 'partial': return name + ': ' + s.missing + ' frame' + (s.missing === 1 ? '' : 's') + ' did not load' + (s.since ? ', from ' + w(s.since) : '') + '.';
      case 'old': return name + ': not kept this far back.';
      case 'outside': return name + ': does not cover this spot.';
      case 'off': return name + ': off.';
      default: return name + '.';
    }
  }
  /* radar frames: [{t, st: 'ok'|'bad'|'wait'}] -> a source state */
  function radarState(frames) {
    var bad = frames.filter(function (f) { return f.st === 'bad'; });
    var ok = frames.filter(function (f) { return f.st === 'ok'; });
    if (!bad.length) return ok.length ? { id: 'radar', state: 'ok', newest: ok[ok.length - 1].t } : { id: 'radar', state: 'loading' };
    if (!ok.length) return { id: 'radar', state: 'down', since: null };
    var lastOk = ok[ok.length - 1].t, tailBad = bad.every(function (f) { return f.t > lastOk; });
    if (tailBad) return { id: 'radar', state: 'down', since: lastOk };
    return { id: 'radar', state: 'partial', missing: bad.length, since: bad[0].t };
  }

  var api = {
    MIN: MIN, HOUR: HOUR, LAYERS: LAYERS, DEFAULT_LAYERS: DEFAULT_LAYERS, CREDITS: CREDITS, WMS: WMS,
    NEAR_HAIL_MI: NEAR_HAIL_MI, REPORT_MI: REPORT_MI, HOURS_STALE_H: HOURS_STALE_H, RADAR_LAG_MIN: RADAR_LAG_MIN,
    windowSpec: windowSpec, snapDown: snapDown, latestEnd: latestEnd, frameTimes: frameTimes, nearestIndex: nearestIndex,
    stamp: stamp, parseStamp: parseStamp, radarTileUrl: radarTileUrl, lsrUrl: lsrUrl, capsUrl: capsUrl, wmsUrl: wmsUrl,
    featureInfoUrl: featureInfoUrl, parseTimeDimension: parseTimeDimension, capsTimes: capsTimes, matchTime: matchTime,
    encodeShare: encodeShare, decodeShare: decodeShare, layerString: layerString, parseLayers: parseLayers,
    miles: miles, bearing8: bearing8, inGeom: inGeom, distToGeomMi: distToGeomMi,
    hailHours: hailHours, hoursCoverage: hoursCoverage, dailyHail: dailyHail, lsrHail: lsrHail,
    lightningStrikes: lightningStrikes, featureInfoValue: featureInfoValue,
    clock: clock, weekday: weekday, when: when, span: span, tzName: tzName, frameLabel: frameLabel, hailIn: hailIn, rainIn: rainIn,
    caption: caption, sourceLine: sourceLine, radarState: radarState
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgStormCore = api;
})(typeof window !== 'undefined' ? window : this);
