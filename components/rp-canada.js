/* components/rp-canada.js: Rain Print for Canadian farms (2026-10-16).
 *
 * Sig: "make the rain print inclusive for Canadian farmers: does Canada have a
 * rain gauge system we can grab, and offer them metric or French."
 *
 * WHERE THE NUMBERS COME FROM (nothing invented, nothing filled in)
 *   place     a Canadian town ("Regina, SK", "Saint-Hyacinthe QC", "Brandon
 *             Manitoba") through Open-Meteo's geocoder (countryCode=CA), or a
 *             postal code's first three characters (the FSA) through
 *             data/rain-print-ca/fsa.json (GeoNames, CC BY 4.0). A rural FSA
 *             (second character 0) covers too much ground to stand for a farm:
 *             the page asks for the nearest town instead.
 *   stations  data/rain-print-ca/stations.json (scripts/build_rp_canada.py):
 *             the Canadian stations in NOAA's GHCN-Daily, which carries
 *             Environment and Climate Change Canada's climate stations
 *             (source C) and CoCoRaHS Canada volunteer gauges (source N).
 *   days      that station's GHCN-Daily file on NOAA's public S3 copy
 *             (noaa-ghcn-pds, open to any browser), read a year at a time
 *             with byte ranges (the files run in date order).
 *   compare   the station's own 1991-2020 monthly averages, from whole months
 *             of its own record (built in the station list; not ECCC's
 *             published normals), spread evenly over each month's days.
 *
 * The engine (components/rain-print.js) asks this file for the same shapes
 * RCC-ACIS sends for a US station (StnMeta-like station lists, StnData-like
 * rows), so every rule after that is the US path's own: missing days are
 * gaps, more than 31 refuse the print, at most 10 is preferred, snow is drawn
 * only where the station kept a whole snowfall record, a multi-day total is
 * an A day with S days before it.
 *
 * A day counts when it passes NOAA's quality checks (no Q flag) and came from
 * ECCC or CoCoRaHS; values GHCN made from hourly summaries (source S and the
 * like) are left out, as NOAA advises. M-flag T or H is a trace; P ("missing,
 * presumed zero") and I (no report) are missing.
 *
 * UNITS AND LANGUAGE. Canada prints in mm and cm by default (ECCC, the
 * provincial crop reports and the farm papers all report rain in mm), with
 * an inches switch; Quebec opens in French, every other province in English,
 * with a French switch. The design carries the choice (u=, lang= and a letter
 * in the design code), so the QR, the order and the gift card draw the same.
 *
 * CREDITS (ECCC Data Servers End-use Licence 2.1.1, section 3): "Data Source:
 * Environment and Climate Change Canada", and for a CoCoRaHS gauge the
 * volunteer network too, with a link to the licence. No ECCC name, crest or
 * logo is used as a mark, and nothing says ECCC endorses the print.
 *
 * Pure parts run in node for test/rp-canada.test.mjs (fetch is passed in).
 */
(function (root) {
  'use strict';

  var S3 = 'https://noaa-ghcn-pds.s3.amazonaws.com';
  var STATIONS_URL = '/data/rain-print-ca/stations.json?v=1', FSA_URL = '/data/rain-print-ca/fsa.json?v=1';
  var LICENCE_URL = 'https://eccc-msc.github.io/open-data/licence/readme_en/';
  var LICENCE_URL_FR = 'https://eccc-msc.github.io/open-data/licence/readme_fr/';

  // ---------------------------------------------------------------- provinces
  /* units: what the print opens in; lang: the page and print language it opens in. */
  var PROV = {
    ab: { en: 'Alberta', fr: 'Alberta' },
    bc: { en: 'British Columbia', fr: 'Colombie-Britannique' },
    mb: { en: 'Manitoba', fr: 'Manitoba' },
    nb: { en: 'New Brunswick', fr: 'Nouveau-Brunswick' },
    nl: { en: 'Newfoundland and Labrador', fr: 'Terre-Neuve-et-Labrador' },
    ns: { en: 'Nova Scotia', fr: 'Nouvelle-Écosse' },
    nt: { en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest' },
    nu: { en: 'Nunavut', fr: 'Nunavut' },
    on: { en: 'Ontario', fr: 'Ontario' },
    pe: { en: 'Prince Edward Island', fr: 'Île-du-Prince-Édouard' },
    qc: { en: 'Quebec', fr: 'Québec' },
    sk: { en: 'Saskatchewan', fr: 'Saskatchewan' },
    yt: { en: 'Yukon', fr: 'Yukon' }
  };
  // the first letter of a postal code is its province (X is the two northern territories)
  var POSTAL_PROV = { A: 'nl', B: 'ns', C: 'pe', E: 'nb', G: 'qc', H: 'qc', J: 'qc', K: 'on', L: 'on', M: 'on', N: 'on', P: 'on', R: 'mb', S: 'sk', T: 'ab', V: 'bc', Y: 'yt' };
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  var NAMES = {};
  Object.keys(PROV).forEach(function (k) { NAMES[fold(PROV[k].en)] = k; NAMES[fold(PROV[k].fr)] = k; });
  NAMES['pei'] = 'pe'; NAMES['p.e.i.'] = 'pe'; NAMES['newfoundland'] = 'nl'; NAMES['labrador'] = 'nl'; NAMES['nfld'] = 'nl';
  NAMES['que'] = 'qc'; NAMES['pq'] = 'qc'; NAMES['sask'] = 'sk'; NAMES['alta'] = 'ab'; NAMES['man'] = 'mb'; NAMES['ont'] = 'on';
  function provOf(s) {
    var f = fold(s).replace(/\.$/, '');
    if (PROV[f]) return f;
    return NAMES[f] || NAMES[f.replace(/\./g, '')] || '';
  }
  function defaultsFor(prov) { return { units: 'mm', lang: prov === 'qc' ? 'fr' : 'en' }; }

  // ---------------------------------------------------------------- the query
  /* "Regina, SK", "Regina SK", "Saint-Hyacinthe, Québec", "Brandon Manitoba",
     "Steinbach, MB, Canada", "S4P 3Y2", "s4p" -> {postal, fsa, town, prov} or null
     (not Canadian: the US path takes it, exactly as before). */
  var POSTAL_RE = /^\s*([ABCEGHJKLMNPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s*(\d[ABCEGHJ-NPRSTV-Z]\d)?\s*$/i;
  function parseQuery(q) {
    var s = String(q || '').trim().replace(/[,\s]+canada\.?$/i, '').trim();
    var pm = POSTAL_RE.exec(s);
    if (pm) {
      var fsa = pm[1].toUpperCase();
      return { postal: fsa + (pm[2] ? ' ' + pm[2].toUpperCase() : ''), fsa: fsa, town: '', prov: POSTAL_PROV[fsa[0]] || (fsa[0] === 'X' ? '' : '') };
    }
    var parts = s.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length >= 2) {
      var pv = provOf(parts[parts.length - 1]);
      return pv && parts[0] ? { postal: '', fsa: '', town: parts.slice(0, -1).join(', '), prov: pv } : null;
    }
    var w = s.split(/\s+/);
    for (var n = Math.min(5, w.length - 1); n >= 1; n--) {
      var tail = w.slice(w.length - n).join(' '), p = provOf(tail);
      // two letters alone must be a code, written as one (sk, SK); a name may be any case
      if (p && (n > 1 || tail.length > 2 || /^[a-z]{2}$/i.test(tail))) return { postal: '', fsa: '', town: w.slice(0, w.length - n).join(' '), prov: p };
    }
    return null;
  }
  function isCanadian(q) { return !!parseQuery(q); }
  // "S4L Regina East" -> "Regina"; neighbourhood names stay as they are
  function fsaTown(place) {
    return String(place || '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+(North|South|East|West|Central|Northeast|Northwest|Southeast|Southwest|Downtown|Outer|Inner|[NSEW]{1,2})$/i, '').trim();
  }
  function placeShort(town, prov) { return town + ', ' + String(prov || '').toUpperCase(); }
  // on the print: "Regina, Saskatchewan" or, in French, "Regina (Saskatchewan)"
  function placeLong(town, prov, lang) {
    var P = PROV[String(prov || '').toLowerCase()];
    if (!P) return town;
    return lang === 'fr' ? town + ' (' + P.fr + ')' : town + ', ' + P.en;
  }

  // ---------------------------------------------------------------- fetching
  // F: the engine's safeFetch (time limit, plain-words errors); in node a fetch stand-in
  var JSON_CACHE = {};
  function getJson(F, url) {
    if (!JSON_CACHE[url]) JSON_CACHE[url] = F(url).then(function (r) { return r.json(); }).then(null, function (e) { delete JSON_CACHE[url]; throw e; });
    return JSON_CACHE[url];
  }
  function fsaTable(F) { return getJson(F, FSA_URL).then(function (j) { return (j && j.fsa) || {}; }); }
  var INDEX = null;
  function stationIndex(F) {
    if (INDEX) return Promise.resolve(INDEX);
    return getJson(F, STATIONS_URL).then(function (j) {
      var f = j.fields, list = (j.s || []).map(function (row) { var o = {}; f.forEach(function (k, i) { o[k] = row[i]; }); return o; });
      INDEX = { y0: j.y0, built: j.built, list: list };
      return INDEX;
    });
  }
  function setIndex(j) { INDEX = null; JSON_CACHE[STATIONS_URL] = Promise.resolve(j); }   // tests

  // ---------------------------------------------------------------- the town
  function haversine(a, b, c, d) { var R = 6371, t = function (x) { return x * Math.PI / 180; }, h = Math.pow(Math.sin(t(c - a) / 2), 2) + Math.cos(t(a)) * Math.cos(t(c)) * Math.pow(Math.sin(t(d - b) / 2), 2); return 2 * R * Math.asin(Math.sqrt(h)); }
  /* The town found, as the engine's town lookup returns it (Open-Meteo's shape)
     plus country_code 'CA' and prov. Errors are Errors with plain words; a
     town name found in more than one place throws {pick: [...]}, as the US path does. */
  function geoPick(P, results, lang) {
    var fr = lang === 'fr';
    var list = (results || []).filter(function (x) { return x && typeof x.latitude === 'number' && typeof x.longitude === 'number' && x.name && (!x.country_code || x.country_code === 'CA'); });
    var inPv = list.filter(function (x) { return provOf(x.admin1) === P.prov; });
    if (!inPv.length) {
      var pn = PROV[P.prov] ? PROV[P.prov][fr ? 'fr' : 'en'] : P.prov.toUpperCase();
      return { error: fr ? 'Impossible de trouver « ' + P.town + ' » en ' + pn + '. Vérifiez l’orthographe de la ville et de la province.'
        : 'Couldn’t find “' + P.town + '” in ' + pn + '. Check the spelling of the town and the province.' };
    }
    // the reader's own spelling when it is the same name (accents kept: "Sainte-Anne-des-Plaines")
    var hits = inPv.map(function (x) { return Object.assign({}, x, { country_code: 'CA', prov: P.prov, name: fold(x.name) === fold(P.town) && /[^\x00-\x7f]/.test(P.town) ? P.town : x.name }); });
    var far = hits.filter(function (x, i) { return i === 0 || haversine(hits[0].latitude, hits[0].longitude, x.latitude, x.longitude) > 30; });
    if (far.length > 1) return { pick: far.slice(0, 6) };
    return { hit: hits[0] };
  }
  function geoAsk(q, F, lang) {
    var P = parseQuery(q), fr = lang === 'fr';
    if (!P) return Promise.reject(new Error('not Canadian'));
    if (P.fsa) {
      return fsaTable(F).then(function (t) {
        var r = t[P.fsa];
        if (!r) throw new Error(fr ? 'Code postal ' + P.postal + ' introuvable. Tapez plutôt la ville et la province, par exemple Saint-Hyacinthe, QC.'
          : 'Couldn’t find postal code ' + P.postal + '. Type the town and province instead, like Regina, SK.');
        var town = fsaTown(r[2]), pv = String(r[3] || '').toLowerCase();
        if (P.fsa[1] === '0') {
          // a rural postal area: hundreds of km across, so its centre is no farm's weather
          var area = String(r[2] || '').replace(/\s*\(([^)]*)\)\s*$/, ', around $1');
          var e = new Error(fr ? 'Le code ' + P.fsa + ' couvre une grande région rurale (' + area + '). Tapez plutôt la ville la plus proche de la ferme, par exemple ' + (town || 'Saint-Hyacinthe') + ', ' + pv.toUpperCase() + '.'
            : P.fsa + ' is a rural postal area that covers a lot of ground (' + area + '). Type the town nearest the farm instead, like ' + placeShort(String(r[2]).replace(/^.*\(([^)]*)\).*$/, '$1') || 'Regina', pv) + '.');
          e.rural = true;
          throw e;
        }
        return { name: town, latitude: r[0], longitude: r[1], admin1: PROV[pv] ? PROV[pv].en : pv, country_code: 'CA', prov: pv, postal: P.fsa };
      });
    }
    var u = 'https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&countryCode=CA&name=' + encodeURIComponent(P.town);
    return F(u).then(function (r) { return r.json(); }).then(function (j) {
      var r = geoPick(P, j && j.results, lang);
      if (r.error) throw new Error(r.error);
      if (r.pick) { var e = new Error('pick'); e.pick = r.pick; throw e; }
      return r.hit;
    });
  }

  // ---------------------------------------------------------------- stations
  function isSid(sid) { return /^CA[0-9A-Z]{9}$/.test(String(sid || '')); }
  var WORD = { CDA: 'CDA', RCS: 'RCS', CS: 'CS', A: 'Airport', AUT: 'Auto', INTL: 'International', STN: 'Station', ON: 'ON', CLIMATE: 'Climate', TOWN: 'Town', EXP: 'Experimental', FARM: 'Farm' };
  var SMALL_FR = { de: 1, du: 1, des: 1, la: 1, le: 1, les: 1, sur: 1, en: 1, aux: 1, et: 1 };
  function titleWord(w, first) {
    var u = w.toUpperCase();
    if (WORD[u]) return WORD[u];
    if (/\d/.test(w)) return u;
    // French place names: "SAINT-GERMAIN-DE-GRANTHAM" -> "Saint-Germain-de-Grantham"; "QU'APPELLE" -> "Qu'Appelle"
    return u.split('-').map(function (p, i) {
      var l = p.toLowerCase();
      if ((i > 0 || !first) && SMALL_FR[l]) return l;
      return l.replace(/(^|['\/])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); });
    }).join('-');
  }
  /* GHCN names come in capitals. A CoCoRaHS name carries an offset ("REGINA 3.8 NW")
     whose unit isn't stated, so the page leaves it off and gives its own distance. */
  function niceName(raw, src) {
    var s = String(raw || '').trim().replace(/\s+/g, ' ');
    if (src === 'N') s = s.replace(/ \d+(?:\.\d+)? ?[NSEW]{1,3}$/, '').replace(/ - .*$/, '');
    return s.split(' ').map(function (w, i) { return titleWord(w, i === 0); }).join(' ');
  }
  function isoMinusDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10); }
  /* The letter for a year (a, b, c, - ; see the build script) or '' when the list doesn't know it yet. */
  function letter(s, y0, year) { var i = year - y0; return i >= 0 && i < String(s.q || '').length ? s.q.charAt(i) : ''; }
  /* Stations near (lat, lon) that can make year's print, as the engine's station
     list (ACIS StnMeta-like): {sid, name, state, ll [lon, lat], elev (ft), km,
     snowOk, ca: true, src, nm}. A year the list knows must have at most 31 days
     missing ('a', 'b' or 'c'); a year it doesn't know yet (this year, or last
     year before the list is rebuilt) needs a station still reporting
     (o.today minus o.stale days) whose year before was whole enough. Whole
     years first (a, b), nearest first, then the rest. */
  var BOX_KM = 70;
  function nearby(index, lat, lon, year, o) {
    o = o || {};
    var late = o.today ? isoMinusDays(o.today, o.stale || 30) : '';
    var out = [];
    index.list.forEach(function (s) {
      var km = haversine(lat, lon, s.la, s.lo);
      if (km > BOX_KM) return;
      var L = letter(s, index.y0, year), known = !!L, prev = letter(s, index.y0, year - 1);
      if (known && L === '-') return;
      if (!known) {
        if (!late || String(s.last) < late) return;
        if (prev === '-' ) return;
        L = prev === 'a' || prev === 'b' ? prev : 'c';
      }
      out.push({ sid: s.id, name: niceName(s.n, s.src), rawName: s.n, state: String(s.p).toUpperCase(), ll: [s.lo, s.la],
        valid_daterange: [[(s.f || year) + '-01-01', String(s.last || year + '-12-31')]],
        elev: typeof s.el === 'number' ? Math.round(s.el * 3.28084) : null, km: km,
        snowOk: L === 'a' ? true : L === 'b' ? false : null, whole: L === 'a' || L === 'b', ca: true, src: s.src, nm: s.nm, ny: s.ny });
    });
    return out.sort(function (a, b) { return (a.whole === b.whole ? 0 : a.whole ? -1 : 1) || a.km - b.km; });
  }
  function stations(F, lat, lon, year, o) { return stationIndex(F).then(function (ix) { return nearby(ix, lat, lon, year, o); }); }
  function stationMeta(F, sid) {
    return stationIndex(F).then(function (ix) { for (var i = 0; i < ix.list.length; i++) if (ix.list[i].id === sid) return ix.list[i]; return null; });
  }

  // ---------------------------------------------------------------- one year of days
  /* GHCN by_station CSV: ID,DATE,ELEMENT,VALUE,M,Q,S,OBS_TIME, in date order
     (each month's elements together). The year is found by its byte range:
     a HEAD for the size, a few 2 KB probes (interpolation, then halving), then
     the year read forward in 96 KB pieces. */
  var PROBE = 2048, CHUNK = 98304;
  function firstDate(text, skipPartial) {
    var i = skipPartial ? text.indexOf('\n') + 1 : 0;
    while (i > 0 || !skipPartial) {
      var j = text.indexOf('\n', i);
      if (j < 0) return null;
      var f = text.slice(i, j).split(',');
      if (f.length >= 4 && /^\d{8}$/.test(f[1])) return { date: f[1], at: i };
      i = j + 1; skipPartial = true;
    }
    return null;
  }
  function dayNum(d) { return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 86400000; }
  function rangeText(F, url, a, b) {
    return F(url, { headers: { Range: 'bytes=' + a + '-' + b } }).then(function (r) { return r.text(); });
  }
  function fileSize(F, url) {
    return F(url, { method: 'HEAD' }).then(function (r) {
      var n = parseInt(r.headers && r.headers.get ? r.headers.get('content-length') : '', 10);
      if (!(n > 0)) throw new Error('NOAA didn’t say how big the station’s file is.');
      return n;
    });
  }
  /* -> Promise of the CSV lines of year (strings). */
  function yearLines(F, sid, year) {
    var url = S3 + '/csv/by_station/' + sid + '.csv', want = year + '0101', stop = (year + 1) + '0101';
    return fileSize(F, url).then(function (size) {
      var probe = function (off) {
        return rangeText(F, url, off, Math.min(size - 1, off + PROBE - 1)).then(function (t) { var d = firstDate(t, off > 0); return d ? { off: off + d.at, date: d.date } : null; });
      };
      return Promise.all([probe(0), probe(Math.max(0, size - PROBE * 2))]).then(function (ends) {
        if (!ends[0]) throw new Error('That station’s file has no days in it.');
        if (ends[0].date >= want) return 0;
        var lo = ends[0], hi = { off: size, date: ends[1] ? ends[1].date : '99991231' };
        if (hi.date < want) return size;   // the record ends before the year
        var steps = 0;
        // lo.date < want <= (first line after hi.off), so the year starts in (lo.off, hi.off]
        var step = function () {
          if (hi.off - lo.off <= PROBE * 2 || steps > 30) return lo.off;
          steps++;
          var span = hi.off - lo.off, frac = steps % 3 === 0 ? 0.5 : (dayNum(want) - dayNum(lo.date)) / Math.max(1, dayNum(hi.date) - dayNum(lo.date));
          var mid = Math.round(lo.off + Math.min(0.95, Math.max(0.05, frac)) * span) - PROBE / 2;
          mid = Math.max(lo.off + 1, Math.min(hi.off - PROBE, mid));
          return probe(mid).then(function (p) {
            if (!p || p.off >= hi.off) { hi = { off: mid, date: hi.date }; return step(); }
            if (p.date < want) lo = p; else hi = p;
            return step();
          });
        };
        return step();
      }).then(function (from) {
        var lines = [], carry = '';
        var read = function (off) {
          if (off >= size) return lines;
          return rangeText(F, url, off, Math.min(size - 1, off + CHUNK - 1)).then(function (t) {
            var all = (carry + t).split('\n'), done = false;
            carry = off + CHUNK < size ? all.pop() : '';
            for (var i = 0; i < all.length; i++) {
              var f = all[i].split(',');
              if (f.length < 4 || !/^\d{8}$/.test(f[1])) continue;
              if (f[1] >= stop) { done = true; break; }
              if (f[1] >= want) lines.push(all[i]);
            }
            return done ? lines : read(off + CHUNK);
          });
        };
        return read(from);
      });
    });
  }

  // ---------------------------------------------------------------- the day rules
  var SOURCES = { C: 1, N: 1 };
  function rowsByDate(lines) {
    var by = {};
    lines.forEach(function (l) {
      var f = String(l).split(',');
      if (f.length < 7 || !/^\d{8}$/.test(f[1])) return;
      var v = parseInt(f[3], 10);
      if (isNaN(v)) return;
      (by[f[1]] || (by[f[1]] = {}))[f[2]] = { v: v, m: f[4] || '', q: f[5] || '', s: f[6] || '' };
    });
    return by;
  }
  function good(x) { return x && !x.q && SOURCES[x.s] && x.m !== 'P' && x.m !== 'I' && x.v >= 0; }
  var IN = function (mm) { return mm / 25.4; };
  function fmtIn(x) { return String(Math.round(x * 1e6) / 1e6); }
  function fmtF(c10) { return String(Math.round((c10 / 10 * 9 / 5 + 32) * 10) / 10); }
  /* One calendar year as ACIS StnData rows, elems pcpn,avgt,snow,maxt,mint
     (inches and F, as the engine reads a US station): 'M' missing, 'T' trace,
     'S' a day inside a multi-day total, '1.23A' the total itself. */
  function acisRows(by, year, lastIso) {
    var out = [], d0 = Date.UTC(year, 0, 1), n = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    for (var k = 0; k < n; k++) {
      var iso = new Date(d0 + k * 86400000).toISOString().slice(0, 10);
      if (lastIso && iso > lastIso) break;
      var key = iso.replace(/-/g, ''), r = by[key] || {}, p = r.PRCP, pc = 'M';
      if (good(p)) pc = p.m === 'T' || p.m === 'H' ? 'T' : fmtIn(IN(p.v / 10));
      var sn = r.SNOW, sc = 'M';
      if (good(sn)) sc = sn.m === 'T' ? 'T' : fmtIn(IN(sn.v));
      var tx = r.TMAX, tn = r.TMIN, mx = tx && !tx.q ? fmtF(tx.v) : 'M', mn = tn && !tn.q ? fmtF(tn.v) : 'M';
      var av = mx !== 'M' && mn !== 'M' ? String(Math.round((+mx + +mn) / 2 * 10) / 10) : 'M';
      out.push([iso, pc, av, sc, mx, mn]);
    }
    // a multi-day total (MDPR over DAPR days, ending on its day): the days before it become S, the day itself A
    for (var i = 0; i < out.length; i++) {
      var rr = by[out[i][0].replace(/-/g, '')] || {}, md = rr.MDPR, da = rr.DAPR;
      if (out[i][1] !== 'M' || !good(md) || !da || !(da.v >= 2 && da.v <= 40) || i - da.v + 1 < 0) continue;
      var clear = true;
      for (var j = i - da.v + 1; j < i; j++) if (out[j][1] !== 'M') clear = false;
      if (!clear) continue;
      for (j = i - da.v + 1; j < i; j++) out[j][1] = 'S';
      out[i][1] = fmtIn(IN(md.v / 10)) + 'A';
    }
    return out;
  }
  /* The engine's StnData answer for one station-year: {meta: {name, state, ll}, data: rows}. */
  function yearJson(F, sid, year, o) {
    o = o || {};
    return Promise.all([stationMeta(F, sid), yearLines(F, sid, year)]).then(function (res) {
      var s = res[0], by = rowsByDate(res[1]);
      if (!s) throw new Error('That station isn’t in the Canadian station list. Pick another one under Weather station.');
      // this year: the calendar up to today; the engine trims to the last day reported
      var last = year === o.currentYear ? o.today : '';
      return { meta: { name: niceName(s.n, s.src), state: String(s.p).toUpperCase(), ll: [s.lo, s.la], ca: true, src: s.src }, data: acisRows(by, year, last) };
    });
  }

  /* The full record as ACIS sdate=por rows (pcpn, avgt), every day from the first
     report to the last ('M' between): what the station-average comparison and the
     remarkable days rank against. One file, gzip when the browser can unpack it. */
  var POR_CACHE = {};
  function porJson(F, sid) {
    if (POR_CACHE[sid]) return POR_CACHE[sid];
    var gz = typeof root.DecompressionStream === 'function';
    var url = S3 + (gz ? '/csv.gz/by_station/' + sid + '.csv.gz' : '/csv/by_station/' + sid + '.csv');
    var p = F(url).then(function (r) {
      if (!gz) return r.text();
      return new Response(r.body.pipeThrough(new root.DecompressionStream('gzip'))).text();
    }).then(function (text) { return { data: porRows(text) }; });
    POR_CACHE[sid] = p.then(null, function (e) { delete POR_CACHE[sid]; throw e; });
    return POR_CACHE[sid];
  }
  function porRows(text) {
    var lines = String(text).split('\n').filter(function (l) { return /,(PRCP|MDPR|DAPR|TMAX|TMIN),/.test(l); });
    var by = rowsByDate(lines), keys = Object.keys(by).filter(function (k) { return good(by[k].PRCP) || good(by[k].MDPR); }).sort();
    if (!keys.length) return [];
    var y0 = +keys[0].slice(0, 4), y1 = +keys[keys.length - 1].slice(0, 4), out = [];
    var lastIso = keys[keys.length - 1].slice(0, 4) + '-' + keys[keys.length - 1].slice(4, 6) + '-' + keys[keys.length - 1].slice(6);
    var firstIso = keys[0].slice(0, 4) + '-' + keys[0].slice(4, 6) + '-' + keys[0].slice(6);
    for (var y = y0; y <= y1; y++) acisRows(by, y, y === y1 ? lastIso : '').forEach(function (r) { if (r[0] >= firstIso) out.push([r[0], r[1], r[2]]); });
    return out;
  }

  /* The comparison: the station's 1991-2020 monthly averages (mm), each spread
     evenly over its month's days, as ACIS normal rows [date, inches]. A station
     without its own (fewer than 20 whole years in some month: every CoCoRaHS
     gauge, which started in 2013) borrows the nearest station's within
     NORMAL_KM, and the print says whose (normalFrom). None near: it fails, and
     the page says there's no comparison line, as for a US station with no normal. */
  var NORMAL_KM = 40, NORM_FROM = {};
  function normalFor(ix, s) {
    if (s.nm && s.nm.length === 12) return { s: s, km: 0, own: true };
    var best = null;
    ix.list.forEach(function (o) {
      if (!o.nm || o.nm.length !== 12) return;
      var km = haversine(s.la, s.lo, o.la, o.lo);
      if (km <= NORMAL_KM && (!best || km < best.km)) best = { s: o, km: km, own: false };
    });
    return best;
  }
  function normalJson(F, sid, year) {
    return stationIndex(F).then(function (ix) {
      var s = null;
      for (var i = 0; i < ix.list.length; i++) if (ix.list[i].id === sid) { s = ix.list[i]; break; }
      var pick = s ? normalFor(ix, s) : null;
      if (!pick) { NORM_FROM[sid] = null; throw new Error('no normal'); }
      NORM_FROM[sid] = { own: pick.own, id: pick.s.id, name: niceName(pick.s.n, pick.s.src), km: pick.km, years: pick.s.ny };
      var nm = pick.s.nm, rows = [], d0 = Date.UTC(year, 0, 1), n = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
      for (var k = 0; k < n; k++) {
        var dt = new Date(d0 + k * 86400000), m = dt.getUTCMonth(), dim = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
        rows.push([dt.toISOString().slice(0, 10), fmtIn(IN(nm[m]) / dim)]);
      }
      return { data: rows };
    });
  }
  // whose normals the comparison is: {own, id, name, km, years}, null (none near), undefined (not asked yet)
  function normalFrom(sid) { return NORM_FROM[sid]; }

  // ---------------------------------------------------------------- words
  /* FR-REVIEW: the page's French. Plain Canadian French, to be read by a native speaker before launch. */
  var T = {
    en: {
      gauge: 'Weather station', from: 'from', near: 'near',
      eccc: 'Environment and Climate Change Canada station', cocorahs: 'CoCoRaHS volunteer gauge',
      usualNote: function (n) { return 'A usual year: this station’s 1991–2020 average, from its own records'; },
      usualLabel: '1991–2020 station average',
      source: function (src) { return 'Data Source: Environment and Climate Change Canada' + (src === 'N' ? ' and CoCoRaHS Canada volunteers' : '') + ', through NOAA’s GHCN-Daily'; },
      units: 'Units', mm: 'mm and cm', inch: 'Inches', lang: 'Language',
      noNormal: 'This station has fewer than 20 whole years of 1991–2020 on record, so there’s no usual-year line. Pick an Environment Canada station under Weather station for one.'
    },
    fr: {
      gauge: 'Station météo', from: 'de', near: 'près de',
      eccc: 'station d’Environnement et Changement climatique Canada', cocorahs: 'pluviomètre bénévole CoCoRaHS',
      usualNote: function (n) { return 'Année normale : moyenne 1991–2020 de cette station, selon ses propres relevés'; },
      usualLabel: 'moyenne 1991–2020 de la station',
      source: function (src) { return 'Source des données : Environnement et Changement climatique Canada' + (src === 'N' ? ' et les bénévoles de CoCoRaHS Canada' : '') + ', par le GHCN-Daily de la NOAA'; },
      units: 'Unités', mm: 'mm et cm', inch: 'Pouces', lang: 'Langue',
      noNormal: 'Cette station a moins de 20 années complètes entre 1991 et 2020, donc pas de ligne d’année normale. Choisissez une station d’Environnement Canada sous Station météo pour en avoir une.'
    }
  };
  function words(lang) { return T[lang === 'fr' ? 'fr' : 'en']; }
  /* The station by its id, in words: "Environment Canada climate station 4016322" (the
     last seven characters of a GHCN id are ECCC's own Climate ID), "CoCoRaHS gauge CA1SK000002". */
  function sidPlain(sid, lang) {
    var s = String(sid || ''), fr = lang === 'fr';
    if (/^CA1/.test(s)) return (fr ? 'pluviomètre CoCoRaHS ' : 'CoCoRaHS gauge ') + s;
    return fr ? 'station climatologique ' + s.slice(-7) + ' d’Environnement Canada' : 'Environment Canada climate station ' + s.slice(-7);
  }
  function snowWord(st, snowOk, lang) {
    var fr = lang === 'fr';
    if (st) return st === 'unknown' ? (fr ? 'pluie seulement' : 'rain only') : (fr ? 'pluie et neige' : 'rain and snow');
    return snowOk === true ? (fr ? 'pluie et neige' : 'rain and snow') : snowOk === false ? (fr ? 'pluie seulement' : 'rain only') : '';
  }
  function kmText(km, lang) { var s = km < 1 ? (lang === 'fr' ? 'moins de 1' : 'under 1') : km < 10 ? (Math.round(km * 10) / 10).toFixed(1) : String(Math.round(km)); return (lang === 'fr' ? s.replace('.', ',') : s) + ' km'; }
  /* The station line on the print: "Weather station: Regina RCS, SK, 4.1 km from Regina". */
  function gaugeLine(m, lang) {
    var t = words(lang), nm = m.name + (m.state ? ', ' + m.state : '');
    var dist = m.approx ? t.near + ' ' + m.city : kmText(m.km, lang) + ' ' + t.from + ' ' + m.city;
    if (lang === 'fr') dist = m.approx ? t.near + ' ' + m.city : kmText(m.km, lang) + ' ' + (/^[aeiouyhéèêàâîôû]/i.test(m.city) ? 'd’' + m.city : 'de ' + m.city);
    return t.gauge + (lang === 'fr' ? ' : ' : ': ') + nm + (m.src === 'N' ? (lang === 'fr' ? ' (pluviomètre bénévole)' : ' (volunteer gauge)') : '') + ', ' + dist;
  }

  /* Remarkable days in metric and French, rebuilt from what the records layer
     found (kind, value in inches or F, ties, basis); its English label is the
     fallback. Temperatures to whole degrees C, snow to a tenth of a cm, a
     week's rain to whole mm, a month's to whole mm. */
  var MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTH_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MON_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function nf(v, d, fr) { var s = (+v).toFixed(d); return fr ? s.replace('.', ',') : s; }
  function dayShort(iso, fr) { var p = String(iso).split('-').map(Number); return fr ? (p[2] === 1 ? '1er' : p[2]) + ' ' + MON_FR[p[1] - 1] : MON_EN[p[1] - 1] + ' ' + p[2]; }
  function recordLabel(r, loc) {
    loc = loc || {};
    var mm = loc.units === 'mm', fr = loc.lang === 'fr';
    if (!r || (!mm && !fr)) return r && r.label;
    var C = function (f) { return Math.round((f - 32) * 5 / 9); };
    var deg = function (f) { return mm ? (fr ? C(f) + ' °C' : C(f) + '°C') : (fr ? Math.round(f) + ' °F' : Math.round(f) + '°F'); };
    var col = function (w) { return w + (fr ? ' : ' : ': '); };
    var rainW = function (inch) { return mm ? nf(Math.round(inch * 25.4), 0, fr) + ' mm' : nf(inch, 2, fr) + ' in'; };
    var snowW = function (inch) { return mm ? nf(inch * 2.54, 1, fr) + ' cm' : nf(inch, 1, fr) + ' in'; };
    var ties = r.ties || [], tie = ties.length === 1 ? (fr ? ' (aussi ' : ' (also ') + dayShort(ties[0], fr) + ')' : ties.length > 1 ? (fr ? ' (sur ' + (ties.length + 1) + ' jours)' : ' (on ' + (ties.length + 1) + ' days)') : '';
    var m = r.date ? +String(r.date).slice(5, 7) - 1 : 0, b = r.basis || {};
    var ord = function (k) { return fr ? k + 'e' : k + (k % 10 === 1 && k % 100 !== 11 ? 'st' : k % 10 === 2 && k % 100 !== 12 ? 'nd' : k % 10 === 3 && k % 100 !== 13 ? 'rd' : 'th'); };
    var since = /(\d{4})$/.exec(String(r.label || '')), sy = since ? since[1] : '';
    switch (r.kind) {
      case 'coldest': return col(fr ? 'Journée la plus froide' : 'Coldest day') + deg(r.value) + tie;
      case 'hottest': return col(fr ? 'Journée la plus chaude' : 'Hottest day') + deg(r.value) + tie;
      case 'lastFrost': return col(fr ? 'Dernier gel' : 'Last frost') + deg(r.value);
      case 'firstFrost': return col(fr ? 'Premier gel' : 'First frost') + deg(r.value);
      case 'snowDay': return col(fr ? 'Plus grosse neige' : 'Biggest snow') + snowW(r.value) + tie;
      case 'lastSnow': return col(fr ? 'Dernière neige' : 'Last snow') + snowW(r.value);
      case 'firstSnow': return col(fr ? 'Première neige' : 'First snow') + snowW(r.value);
      case 'wetWeek': return col(fr ? 'Semaine la plus arrosée' : 'Wettest week') + rainW(r.value) + tie;
      case 'wetYear': case 'dryYear': {
        var wet = r.kind === 'wetYear', L = String(r.label || '');
        if (!fr) return L;   // English years carry no amount: the label is already right
        if (/ year since \d{4}$/.test(L)) return (wet ? 'Année la plus arrosée' : 'Année la plus sèche') + ' depuis ' + sy;
        if (/on record here/.test(L)) return (wet ? 'Année la plus arrosée' : 'Année la plus sèche') + ' jamais mesurée ici, depuis ' + sy;
        return (wet ? 'Plus arrosée' : 'Plus sèche') + ' que toutes les années depuis ' + sy;
      }
      case 'wetMonth': case 'dryMonth': case 'warmMonth': case 'coldMonth': {
        var temp = r.kind === 'warmMonth' || r.kind === 'coldMonth';
        var val = temp ? (mm ? (fr ? nf((r.value - 32) * 5 / 9, 1, fr) + ' °C de moyenne' : nf((r.value - 32) * 5 / 9, 1) + '°C average') : (fr ? nf(r.value, 1, fr) + ' °F de moyenne' : nf(r.value, 1) + '°F average')) : rainW(r.value);
        if (fr) {
          var adj = { wetMonth: 'le plus arrosé', dryMonth: 'le plus sec', warmMonth: 'le plus chaud', coldMonth: 'le plus froid' }[r.kind];
          var head = (b.rank > 1 ? ord(b.rank) + ' ' + MONTH_FR[m] : MONTH_FR[m].charAt(0).toUpperCase() + MONTH_FR[m].slice(1)) + ' ' + adj;
          if (b.rank > 1) head = head.charAt(0).toUpperCase() + head.slice(1);
          return (b.tied ? 'À égalité : ' : '') + head + ' en ' + b.of + ' années complètes : ' + val;
        }
        var word = { wetMonth: 'wettest', dryMonth: 'driest', warmMonth: 'warmest', coldMonth: 'coldest' }[r.kind];
        var s2 = (b.tied ? 'tied for ' : '') + (b.rank > 1 ? ord(b.rank) + ' ' : '') + word + ' ' + MONTH_EN[m] + ' of ' + b.of + ' full years: ' + val;
        return s2.charAt(0).toUpperCase() + s2.slice(1);
      }
    }
    return r.label;
  }
  function localizeRecords(list, loc) {
    return (list || []).map(function (r) { var l = recordLabel(r, loc); return l === r.label ? r : Object.assign({}, r, { label: l }); });
  }

  // ---------------------------------------------------------------- the page in French
  /* FR-REVIEW: the page's own words, by element: [selector, how, English for a
     Canadian design, French]. how: 'text' (the whole text), 'tail' (the text
     after a numbered badge), 'ph' (the placeholder), 'opt' (a select's options,
     by value). The English column is what a Canadian design shows in English
     where the US words would be wrong (the comparison is not NOAA's). The US
     page keeps its own words: restore() puts back what was there. The order
     step, checkout and Sig's emails stay in English (the page says so). */
  var PAGE = [
    ['#rp-draw-h', 'tail', null, 'Où et quand'],
    ['label.rp-place > span', 'text', null, 'Ville la plus proche de la ferme ou de la maison'],
    ['label.rp-year > span', 'text', null, 'Année'],
    ['#rp-go', 'text', null, 'Dessiner mon année'],
    ['#rp-design-h', 'tail', null, 'Vos mots '],
    ['#rp-design-h .rp-step-opt', 'text', null, '(tout est facultatif)'],
    ['#rp-name', 'label', null, 'Nom sur le tirage'],
    ['#rp-name', 'ph', null, 'La ferme Tremblay'],
    ['#rp-ded', 'label', null, 'Une ligne sous le nom'],
    ['#rp-ded', 'ph', null, 'Pour papa, sa 40e récolte. Bisous, Julie'],
    ['#rp-dates-h', 'tail0', null, 'Marquer une journée '],
    ['#rp-dates-h .rp-step-opt', 'text', null, '(jusqu’à 5)'],
    ['#rp-m1h', 'text', null, 'Jour 1'], ['#rp-m2h', 'text', null, 'Jour 2'], ['#rp-m3h', 'text', null, 'Jour 3'], ['#rp-m4h', 'text', null, 'Jour 4'], ['#rp-m5h', 'text', null, 'Jour 5'],
    ['#rp-add-day', 'text', null, '+ Marquer une autre journée'],
    ['#rp-more > summary', 'text', null, 'Plus d’options : comparaison, station, normales, journées remarquables, logo'],
    ['#rp-cmp', 'label', null, 'Comparer avec'],
    ['#rp-cmp', 'opt', { normal: '1991\u20132020 average' }, { none: 'Rien', normal: 'Moyenne 1991\u20132020', station: 'Tout l’historique de la station' }],
    ['#rp-cmp-hint', 'text', 'Nothing: just your year. 1991\u20132020 average: a usual year by this station\u2019s own 1991\u20132020 months (or the nearest station\u2019s, named on the print). Full record: this station\u2019s own average over every year it has kept.',
      'Rien : seulement votre année. Moyenne 1991\u20132020 : une année normale selon les mois 1991\u20132020 de cette station (ou de la station la plus proche, nommée sur le tirage). Tout l’historique : la moyenne de cette station sur toutes ses années.'],
    ['#rp-station', 'label', null, 'Station météo'],
    ['#rp-station-hint', 'text', null, 'Pluie et neige : elle mesure aussi la neige, donc la neige peut paraître sur le tirage. Pluie seulement : pas de neige sur le tirage. Toutes ces stations peuvent faire le tirage.'],
    ['#rp-normals', 'label', 'Show the 1991\u20132020 averages', 'Afficher les moyennes 1991\u20132020'],
    ['#rp-records', 'label', null, 'Afficher les journées remarquables'],
    ['.rp-stats-d > summary', 'text', null, 'L’année en chiffres'],
    ['#rp-dl', 'text', null, 'Télécharger un aperçu'],
    ['#rp-copy', 'text', null, 'Copier le lien'],
    ['#rp-buy-h', 'tail', null, 'Comment le voulez-vous?'],
    ['.rp-prod[data-choice="framed12x18"] .rp-prod-t', 'text', null, 'Encadré'],
    ['.rp-prod[data-choice="print12x18"] .rp-prod-t', 'text', null, 'Tirage'],
    ['.rp-prod[data-choice="digital"] .rp-prod-t', 'text', null, 'Fichier numérique'],
    ['#rp-units-mm', 'text', null, 'mm et cm'],
    ['#rp-units-in', 'text', null, 'Pouces']
  ];
  function nodeFor(doc, sel, how) {
    var el = doc.querySelector(sel);
    if (!el) return null;
    if (how === 'label') { var lb = el.closest('label'); return lb ? lb.querySelector('span') : null; }
    return el;
  }
  // the text node a 'tail' (after the badge) or 'tail0' (before the small print) rewrites
  function textNode(el, how) {
    var kids = Array.prototype.slice.call(el.childNodes).filter(function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    return how === 'tail0' ? kids[0] : kids[kids.length - 1];
  }
  var SAVED = null;
  /* lang: 'en' | 'fr'; ca: a Canadian design. English for a US design puts every word back. */
  function applyPage(doc, lang, ca) {
    if (!doc || !doc.querySelector) return;
    if (!SAVED) {
      SAVED = PAGE.map(function (r) {
        var el = nodeFor(doc, r[0], r[1]);
        if (!el) return null;
        if (r[1] === 'ph') return el.getAttribute('placeholder');
        if (r[1] === 'opt') { var o = {}; Array.prototype.forEach.call(el.options, function (x) { o[x.value] = x.textContent; }); return o; }
        if (r[1] === 'tail' || r[1] === 'tail0') { var t = textNode(el, r[1]); return t ? t.nodeValue : null; }
        return el.textContent;
      });
    }
    var fr = ca && lang === 'fr';
    PAGE.forEach(function (r, i) {
      var el = nodeFor(doc, r[0], r[1]), orig = SAVED[i];
      if (!el || orig === null || orig === undefined) return;
      var want = fr ? r[3] : ca && r[2] ? r[2] : orig;
      if (r[1] === 'ph') el.setAttribute('placeholder', want);
      else if (r[1] === 'opt') Array.prototype.forEach.call(el.options, function (x) { var w = (fr ? r[3] : ca && r[2] ? Object.assign({}, orig, r[2]) : orig)[x.value]; if (w) x.textContent = w; });
      else if (r[1] === 'tail' || r[1] === 'tail0') { var t = textNode(el, r[1]); if (t) t.nodeValue = want; }
      else el.textContent = want;
    });
    if (doc.documentElement && doc.documentElement.setAttribute) doc.documentElement.setAttribute('lang', fr ? 'fr-CA' : 'en');
  }

  root.AgRpCanada = {
    applyPage: applyPage, PAGE: PAGE,
    PROV: PROV, POSTAL_PROV: POSTAL_PROV, parseQuery: parseQuery, isCanadian: isCanadian, provOf: provOf, defaultsFor: defaultsFor,
    placeShort: placeShort, placeLong: placeLong, fsaTown: fsaTown, geoPick: geoPick, geoAsk: geoAsk,
    isSid: isSid, niceName: niceName, nearby: nearby, stations: stations, stationIndex: stationIndex, stationMeta: stationMeta, setIndex: setIndex,
    yearLines: yearLines, rowsByDate: rowsByDate, acisRows: acisRows, yearJson: yearJson, porJson: porJson, porRows: porRows, normalJson: normalJson, normalFrom: normalFrom, normalFor: normalFor,
    words: words, kmText: kmText, gaugeLine: gaugeLine, sidPlain: sidPlain, snowWord: snowWord, recordLabel: recordLabel, localizeRecords: localizeRecords,
    LICENCE_URL: LICENCE_URL, LICENCE_URL_FR: LICENCE_URL_FR, S3: S3, T: T
  };
})(typeof window !== 'undefined' ? window : this);
