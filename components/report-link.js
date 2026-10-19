/* components/report-link.js: the short link a printed report's QR carries (Oct 19, 2026).
   Sig: the QR as simple as it can be, the fewest squares that still open the exact report.
   So the code holds HTTPS://AGSIST.COM/Q?<kind><fields>: upper case, digits and + - . * :
   only, which QR stores as alphanumeric (5.5 bits a letter instead of 8), with the "?" as
   the one byte. /Q (Q.html) turns it back into the report's full link and opens it.
   Defaults are left out; nothing that is not needed to draw the same report goes in.
   No names ever: the comp report link has a parcel number and a county, nothing else.

     C  comp report    P outline | A spot | W town center, I parcel number, K county FIPS,
                       R miles, T to date, F from date (left out when it is 3 years
                       before T; empty = any), M min acres (empty = any), X max acres,
                       L classes, Z every deed type, N how many, D newest first
     L  land report    P outline, S the Field Scout filters (cf=)
     H  hail report    +lat-lon (4 places), R miles, D date of loss

   Numbers: an outline is whole numbers of 1/100000 degree, each with its sign, the first
   point as it is and every next one as the step from the one before (+4529750-9170250+0+500).
   Dates are YYMMDD. A field whose value can hold letters (I, L, S) ends at "*".

     AgReportLink.short(fullUrl) -> 'HTTPS://AGSIST.COM/Q?...' or null (then the QR keeps
       the full link: a parcel number with a space or small letters, an odd date, ...)
     AgReportLink.full(search)   -> the full https://agsist.com/... link, or null  */
(function (G) {
  'use strict';
  var HOST = 'https://agsist.com', SHORT = 'HTTPS://AGSIST.COM/Q?';
  var DEF = { r: '25', amin: '10', n: '15', sort: 'mi', years: 3, hailMi: '10' };
  var WORDY = 'ILS';   // fields whose value may hold letters; they end at '*'

  function yearsBefore(iso, y) {   // the same rule as FSLand.yearsBefore
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso), d = new Date(Date.UTC(+m[1] - y, +m[2] - 1, +m[3]));
    return d.toISOString().slice(0, 10);
  }
  function query(u) {
    var q = {}, i = u.indexOf('?');
    if (i < 0) return q;
    u.slice(i + 1).split('#')[0].split('&').forEach(function (kv) {
      if (!kv) return; var j = kv.indexOf('='), k = j < 0 ? kv : kv.slice(0, j), v = j < 0 ? '' : kv.slice(j + 1);
      try { q[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { q[k] = null; }
    });
    return q;
  }
  function shortDate(iso) { var m = /^20(\d\d)-(\d\d)-(\d\d)$/.exec(iso || ''); return m ? m[1] + m[2] + m[3] : null; }
  function longDate(s) { var m = /^(\d\d)(\d\d)(\d\d)$/.exec(s || ''); return m ? '20' + m[1] + '-' + m[2] + '-' + m[3] : null; }
  function sgn(n) { return (n < 0 ? '-' : '+') + Math.abs(n); }
  // "45.29750,-91.70250~..." <-> "+4529750-9170250+0+500..." (exact at 5 places, else null)
  function packPts(f) {
    var pts = String(f || '').split('~'), out = '', pa = 0, po = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i].split(',');
      if (a.length !== 2 || !/^-?\d+\.\d{5}$/.test(a[0]) || !/^-?\d+\.\d{5}$/.test(a[1])) return null;
      var la = Math.round(+a[0] * 1e5), lo = Math.round(+a[1] * 1e5);
      out += i ? sgn(la - pa) + sgn(lo - po) : sgn(la) + sgn(lo);
      pa = la; po = lo;
    }
    return out;
  }
  function unpackPts(s) {
    var n = String(s || '').match(/[+-]\d+/g);
    if (!n || n.join('') !== s || n.length % 2 || n.length < 2) return null;
    var out = [], la = 0, lo = 0;
    for (var i = 0; i < n.length; i += 2) {
      la = i ? la + +n[i] : +n[i]; lo = i ? lo + +n[i + 1] : +n[i + 1];
      out.push((la / 1e5).toFixed(5) + ',' + (lo / 1e5).toFixed(5));
    }
    return out.join('~');
  }
  function pt(lat, lon) {   // "40.12000","-88.20000" -> "+4012000-8820000"
    return /^-?\d+\.\d{5}$/.test(lat) && /^-?\d+\.\d{5}$/.test(lon) ? sgn(Math.round(+lat * 1e5)) + sgn(Math.round(+lon * 1e5)) : null;
  }
  function num(v) { return /^\d+(\.\d+)?$/.test(String(v)) ? String(v) : null; }
  function field(tag, v) { return v == null ? null : tag + v + (WORDY.indexOf(tag) >= 0 ? '*' : ''); }

  function shortComp(q) {
    var b = [], p;
    if (q.f != null) { if (!(p = packPts(q.f))) return null; b.push('P' + p); }
    else if (q.lat != null) { if (!(p = pt(q.lat, q.lon))) return null; b.push((q.at === 'town' ? 'W' : 'A') + p); }
    if (q.pid != null) { if (!/^[0-9A-Z.\-\/]{1,60}$/.test(q.pid)) return null; b.push(field('I', q.pid)); }
    if (q.fips != null) { if (!/^\d{5}$/.test(q.fips)) return null; b.push('K' + q.fips); }
    if (!b.length) return null;
    if (q.r !== DEF.r) { if (!num(q.r)) return null; b.push('R' + q.r); }
    var to = shortDate(q.to); if (!to) return null; b.push('T' + to);
    if (q.from === 'any') b.push('F');
    else if (q.from !== yearsBefore(q.to, DEF.years)) { var fr = shortDate(q.from); if (!fr) return null; b.push('F' + fr); }
    if (q.amin === 'any') b.push('M');
    else if (q.amin !== DEF.amin) { if (!num(q.amin)) return null; b.push('M' + q.amin); }
    if (q.amax != null) { if (!num(q.amax)) return null; b.push('X' + q.amax); }
    if (q.cls != null) { if (!/^[0-9A-Z]{1,3}(,[0-9A-Z]{1,3})*$/.test(q.cls)) return null; b.push(field('L', q.cls.replace(/,/g, '.'))); }
    if (q.all === '1') b.push('Z');
    if (q.n !== DEF.n) { if (!num(q.n)) return null; b.push('N' + q.n); }
    if (q.sort === 'date') b.push('D'); else if (q.sort !== DEF.sort) return null;
    return 'C' + b.join('');
  }
  function shortLand(q) {
    var p = packPts(q.f); if (!p) return null;
    var out = 'LP' + p;
    if (q.cf) {
      var s = q.cf.replace(/,/g, '+').toUpperCase();
      if (cfBack(s) !== q.cf || /\*/.test(s)) return null;   // only when it comes back exactly
      out += 'S' + s + '*';
    }
    return out;
  }
  function cfBack(s) { return s.split('+').map(function (kv) { var i = kv.indexOf(':'); return i < 0 ? kv : kv.slice(0, i).toLowerCase() + kv.slice(i); }).join(','); }
  function shortHail(q) {
    if (!/^-?\d+\.\d{4}$/.test(q.lat || '') || !/^-?\d+\.\d{4}$/.test(q.lon || '')) return null;
    var trim = function (v) { return (+v >= 0 ? '+' : '') + String(+v); };
    var out = 'H' + trim(q.lat) + trim(q.lon);
    if (q.mi !== DEF.hailMi) { if (!/^\d+$/.test(q.mi || '')) return null; out += 'R' + q.mi; }
    if (q.day) { var d = shortDate(q.day); if (!d) return null; out += 'D' + d; }
    return out;
  }
  function short(u) {
    u = String(u || '');
    if (u.indexOf(HOST + '/') !== 0) return null;
    var path = u.slice(HOST.length).split('?')[0], q = query(u), body = null;
    for (var k in q) if (q[k] == null) return null;
    if (path === '/comp-report') body = shortComp(q);
    else if (path === '/field-report') body = shortLand(q);
    else if (path === '/hail-map') body = shortHail(q);
    return body ? SHORT + body : null;
  }

  // ---- back to the full link (Q.html) ----
  function fields(s) {
    var out = {}, i = 0;
    while (i < s.length) {
      var t = s.charAt(i++), v = '';
      if (!/[A-Z]/.test(t) || out[t] != null) return null;
      if (WORDY.indexOf(t) >= 0) { var e = s.indexOf('*', i); if (e < 0) return null; v = s.slice(i, e); i = e + 1; }
      else { while (i < s.length && /[0-9+\-.]/.test(s.charAt(i))) v += s.charAt(i++); }
      out[t] = v;
    }
    return out;
  }
  function full(s) {
    var kind = s.charAt(0), f = fields(s.slice(1));
    if (!f) return null;
    var b = [], p;
    if (kind === 'C') {
      if (f.P != null) { if (!(p = unpackPts(f.P))) return null; b.push('f=' + encodeURIComponent(p)); }
      else if (f.A != null || f.W != null) {
        var ll = unpackPts(f.A != null ? f.A : f.W); if (!ll || ll.indexOf('~') >= 0) return null;
        var c = ll.split(','); b.push('lat=' + c[0], 'lon=' + c[1]); if (f.W != null) b.push('at=town');
      }
      if (f.I != null) b.push('pid=' + encodeURIComponent(f.I));
      if (f.K != null) { if (!/^\d{5}$/.test(f.K)) return null; b.push('fips=' + f.K); }
      var to = longDate(f.T); if (!to) return null;
      var from = f.F == null ? yearsBefore(to, DEF.years) : f.F === '' ? 'any' : longDate(f.F); if (!from) return null;
      b.push('r=' + (f.R || DEF.r), 'from=' + from, 'to=' + to, 'amin=' + (f.M == null ? DEF.amin : f.M === '' ? 'any' : f.M));
      if (f.X) b.push('amax=' + f.X);
      if (f.L) b.push('cls=' + f.L.split('.').join(','));
      if (f.Z != null) b.push('all=1');
      b.push('n=' + (f.N || DEF.n), 'sort=' + (f.D != null ? 'date' : DEF.sort));
      return HOST + '/comp-report?' + b.join('&');
    }
    if (kind === 'L') {
      if (!(p = unpackPts(f.P))) return null;
      return HOST + '/field-report?f=' + encodeURIComponent(p) + (f.S ? '&cf=' + encodeURIComponent(cfBack(f.S)) : '');
    }
    return null;
  }
  function fullHail(s) {
    var m = /^H([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:R(\d+))?(?:D(\d{6}))?$/.exec(s);
    if (!m) return null;
    var day = m[4] ? longDate(m[4]) : '';
    if (m[4] && !day) return null;
    return HOST + '/hail-map?lat=' + (+m[1]).toFixed(4) + '&lon=' + (+m[2]).toFixed(4) + '&mi=' + (m[3] || DEF.hailMi) + (day ? '&day=' + day : '');
  }
  function fullAny(search) {
    // anything an app adds after the link (&fbclid=...) is dropped
    var s = String(search || '').replace(/^\?/, '').split('#')[0].split('&')[0];
    try { s = decodeURIComponent(s); } catch (e) { return null; }
    s = s.toUpperCase();
    return s.charAt(0) === 'H' ? fullHail(s) : full(s);
  }
  var API = { short: short, full: fullAny, DEF: DEF, SHORT: SHORT };
  if (typeof module === 'object' && module.exports) module.exports = API; else G.AgReportLink = API;
})(typeof window !== 'undefined' ? window : globalThis);
