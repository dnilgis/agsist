/* components/your-state.js: the "Your area" box on seven pages. It loads that page's lines file
   (components/ys-<mode>.js?v=<data-v>) only for a reader with a saved state. A page holds
   <aside class="ya" data-your-state="<mode>" data-v="1" hidden></aside> and loads this file (defer).
   Reads only the saved location (agsist-wx-loc, agsist_zip); writes and sends nothing. Data loads when
   the box nears the screen; stale or missing data prints nothing. Tests: test/your-state.test.mjs */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAY = 864e5, NAMES = {}, MODES = {};
  ('AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming')
    .split('|').forEach(function (s) { NAMES[s.slice(0, 2)] = s.slice(3); });

  function readPlace(ls, mode) {
    var o = null, b = null, p = { state: '', zip: '', county: '', lat: null, lon: null };
    try { o = JSON.parse(ls.getItem('agsist-wx-loc') || 'null'); } catch (e) { }
    if (o && typeof o === 'object') {
      if (NAMES[o.state]) p.state = o.state;
      if (/^\d{5}$/.test(o.zip || '')) p.zip = o.zip;
      if (/^[A-Za-z .'-]{3,40}$/.test(o.county || '')) p.county = o.county;
      if (typeof o.lat === 'number' && typeof o.lon === 'number' && isFinite(o.lat + o.lon)) { p.lat = o.lat; p.lon = o.lon; }
    }
    if (!p.zip) try { var z = String(ls.getItem('agsist_zip') || ''); if (/^\d{5}$/.test(z)) p.zip = z; } catch (e) { }
    if (!p.state && mode === 'cattle') try { b = JSON.parse(ls.getItem('agsist-salebarn') || 'null'); if (b && NAMES[b.state]) p.state = b.state; } catch (e) { }
    return p.state || p.zip || p.lat !== null ? p : null;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function day(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function age(iso, now) { var t = Date.parse(/T/.test(iso || '') ? iso : iso + 'T12:00:00Z'); return isNaN(t) ? Infinity : (now - t) / DAY; }
  function num(x) { return typeof x === 'number' && isFinite(x) ? (x % 1 ? x.toFixed(1) : String(x)) : ''; }
  function commas(x, dp) { return x.toFixed(dp).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function sg(x) { var v = Math.round(x * 10) / 10; return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(1); }
  function money(x) { return '$' + commas(Math.abs(x), 2); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function isoToday(now, tz) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); }
    catch (e) { return new Date(now).toISOString().slice(0, 10); }
  }
  function finals(file, name) {
    var r = file && file.rows || [], i;
    for (i = 0; i < r.length; i++) if (r[i].state === name) return r[i].values || null;
    return null;
  }
  function stat(d, st) { return d && d.stateStats && d.stateStats[st] || null; }
  function usda(s) { return 'USDA’s ' + (s.forecast ? esc(s.forecast_month || '') + ' forecast for ' + s.year : s.year + ' final'); }
  function nassDay(s) { return day(String(s.nass_load_time || '').slice(0, 10)); }
  function statLine(s, name) {
    var c = num(s.corn_yield), b = num(s.bean_yield), p = [];
    if (c) p.push('corn ' + c + ' bu/acre');
    if (b) p.push('soybeans ' + b);
    return p.length ? usda(s) + ' (' + esc(name) + ', ' + nassDay(s) + '): ' + p.join(', ') + '.' : '';
  }
  function countyLink(p, name) {
    var ss = '/arc-plc/' + slug(name);
    return p.county ? '<a data-chk="' + ss + '" href="' + ss + '/' + slug(p.county) + '">ARC or PLC for ' + esc(p.county) + ' &rarr;</a>'
      : '<a href="' + ss + '">ARC or PLC in ' + esc(name) + ' &rarr;</a>';
  }
  function tour(t, st) {
    var all = [], me = null;
    (t && t.nights || []).forEach(function (n) {
      (n.states || []).forEach(function (s) { if (s.publishes === false) return; all.push(s.name); if (s.code === st) me = { s: s, night: n }; });
    });
    return { me: me, names: all.join(', ') };
  }

  /* The box, as HTML. Pure: the tests call it with fixtures. */
  function build(o) {
    o.now = o.now || Date.now(); o.d = o.d || {}; o.links = [];
    var st = o.loc && o.loc.state, m = MODES[o.mode], out = [], src = [];
    if (!st || !m) return none();
    m.build(o, st, NAMES[st], out, src);
    return '<p class="ya-k">Your area: ' + esc(NAMES[st]) + '</p>' + out.map(function (s) { return '<p>' + s + '</p>'; }).join('') +
      (o.links.length ? '<p class="ya-l">' + o.links.join(' &middot; ') + '</p>' : '') +
      (src.length ? '<p class="ya-s">' + src.join('. ') + '.</p>' : '');
  }
  function none() { return '<p class="ya-none"><a href="/cash-bids">See this for your area</a></p>'; }

  var doc = root.document, WAIT = {}, api = {
    readPlace: readPlace, build: build, none: none, NAMES: NAMES, MODES: MODES,
    h: { esc: esc, day: day, age: age, num: num, commas: commas, sg: sg, money: money, slug: slug, isoToday: isoToday, finals: finals, stat: stat, usda: usda, nassDay: nassDay, statLine: statLine, countyLink: countyLink, tour: tour },
    mode: function (name, m) { MODES[name] = m; (WAIT[name] || []).forEach(function (f) { f(); }); WAIT[name] = null; }
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AGSIST_YOUR_STATE = api;
  if (!doc) return;

  function get(u) { return fetch('/data/' + u + '.json', { cache: 'default' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  /* the lines file loads only for a reader with a saved state, once the box nears the screen */
  function load(name, v, f) {
    if (MODES[name]) return f();
    if (WAIT[name]) return WAIT[name].push(f);
    WAIT[name] = [f];
    var s = doc.createElement('script'); s.src = '/components/ys-' + name + '.js?v=' + v; doc.head.appendChild(s);
  }
  function fill(el, loc, name) {
    load(name, el.getAttribute('data-v') || '1', function () {
      var m = MODES[name], f = m.files;
      Promise.all(f.map(get)).then(function (r) {
        var o = { loc: loc, mode: name, d: {}, reports: root.AGSIST_REPORTS };
        f.forEach(function (k, i) { o.d[k] = r[i]; });
        el.innerHTML = build(o);
        Array.prototype.forEach.call(el.querySelectorAll('a[data-chk]'), function (a) {
          fetch(a.getAttribute('href'), { method: 'HEAD' }).then(function (x) { if (!x.ok) throw 0; }).catch(function () {
            a.href = a.getAttribute('data-chk'); a.innerHTML = 'ARC or PLC in ' + esc(NAMES[loc.state]) + ' &rarr;';
          });
        });
        if (m.after) { var n = 0; (function look() { if (!m.after(o, doc) && ++n < 30) setTimeout(look, 300); })(); }
      });
    });
  }
  function boot() {
    var els = doc.querySelectorAll('aside[data-your-state]');
    if (!els.length) return;
    var c = doc.createElement('style');
    c.textContent = 'aside.ya{margin:1rem 0;padding:.7rem .9rem;border:1px solid var(--border);border-left:3px solid var(--green);border-radius:8px;background:var(--surface);font-size:.88rem;line-height:1.55;color:var(--text-dim)}aside.ya p{margin:.25rem 0;font-size:inherit;line-height:inherit;color:inherit}aside.ya b{color:var(--text)}aside.ya .ya-k{font-family:"JetBrains Mono",monospace;font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green)}aside.ya a{color:var(--gold);display:inline-block;padding:.35rem 0}aside.ya .ya-s{font-size:.76rem;color:var(--text-muted)}aside.ya.ya-n{border:0;background:none;padding:0;margin:.5rem 0}';
    doc.head.appendChild(c);
    Array.prototype.forEach.call(els, function (el) {
      var name = el.getAttribute('data-your-state'), loc = null;
      try { loc = readPlace(root.localStorage, name); } catch (e) { }
      el.hidden = false;
      if (!loc || !loc.state) { el.className += ' ya-n'; el.innerHTML = none(); return; }
      el.innerHTML = '<p class="ya-k">Your area: ' + esc(NAMES[loc.state]) + '</p>';
      if (!('IntersectionObserver' in root)) return fill(el, loc, name);
      var io = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fill(el, loc, name); }
      }, { rootMargin: '600px 0px' });
      io.observe(el);
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
