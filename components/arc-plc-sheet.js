/* components/arc-plc-sheet.js: the one counter sheet page, /arc-plc/sheet?c=<state>/<county>
   (scripts/build_arc_plc.py writes the page shell; this fills it).

   Reads the county from ?c=, loads data/arc-plc/math/<ST>.json (the same file
   "Show the math" uses), and lays out the one-page, black and white sheet for
   the FSA office: each crop's short answer for both years, why, the
   deadlines, and a QR code back to the county page (components/qr.js, drawn
   here). The answers and the why lines come from the build as figured
   (AgArcMath.sheetRows); nothing is computed here. */
(function (w, d) {
  'use strict';
  var main = d.getElementById('main'), cfg = d.getElementById('sh-data');
  if (!main || !cfg) return;
  var C = JSON.parse(cfg.textContent), bar = d.getElementById('sh-back');
  var SITE = 'https://agsist.com';

  function esc(s) { return w.AgArcMath ? w.AgArcMath.esc(s) : String(s); }
  function q(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search || '');
    try { return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; } catch (e) { return ''; }
  }
  function say(html) { main.removeAttribute('aria-busy'); main.classList.add('sh-msg'); main.innerHTML = html; }
  function cell(x) { return x ? '<td class="a">' + C.icons[x.shape] + x.word + '</td>' : '<td class="a">' + C.icons.ask + 'No answer yet</td>'; }

  var c = q('c').replace(/^\/+|\/+$/g, '').toLowerCase(), parts = c.split('/');
  var sslug = parts[0] || '', cslug = parts[1] || '', st = C.states[sslug];
  if (!st || !/^[a-z0-9-]+$/.test(cslug)) {
    say('<p>Pick a county first. <a href="/arc-plc">Find your county</a>, then tap <b>Counter sheet for the FSA office</b> on its page.</p>');
    return;
  }
  var page = '/arc-plc/' + sslug + '/' + cslug, url = SITE + page;
  if (bar) bar.setAttribute('href', page);

  function paint(doc) {
    var fips = null;
    Object.keys(doc.c).forEach(function (f) { if (doc.c[f].s === cslug) fips = f; });
    if (!fips) { say('<p>There is no counter sheet for that county. <a href="/arc-plc/' + esc(sslug) + '">Every county in this state</a>.</p>'); return; }
    var g = doc.g, rec = doc.c[fips], LY = g.ly, OY = g.oy, rows = w.AgArcMath.sheetRows(doc, fips);
    var html = rows.map(function (r) { return '<tr><td class="c">' + r.lab + '</td>' + cell(r.ly) + cell(r.oy) + '<td>' + r.why + '</td></tr>'; }).join('');
    var dense = rows.length > 13 ? ' sh-dense sh-xdense' : rows.length > 9 ? ' sh-dense' : '';
    var yearsH = LY < OY ? LY + ' and ' + OY : OY + ' and ' + LY;
    d.title = rec.n + ', ' + g.st + ' ARC or PLC counter sheet | AGSIST';
    var canon = d.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute('href', url);
    if (bar) bar.textContent = 'Back to ' + rec.n;
    main.className = 'ap-sheet' + dense;
    main.innerHTML = '<div class="sh-top">\n    <div><p class="sh-kick">ARC or PLC, ' + yearsH + '</p><h1 class="sh-county">' + esc(rec.n) + '</h1><p class="sh-sub">' + esc(g.n) + '. Which one pays more per base acre?</p></div>\n' +
      '    <p class="sh-brand">AGSIST</p>\n  </div>\n' +
      '  <p class="sh-intro">For a typical farm here: FSA&rsquo;s county average PLC yield and benchmark yield. Prices from ' + esc(g.wz) + ' and futures; county yields from FSA.</p>\n' +
      '  <table class="sh-table"><thead><tr><th scope="col">Crop</th><th scope="col">' + LY + '</th><th scope="col">' + OY + '</th><th scope="col">Why</th></tr></thead>\n' +
      '  <tbody>' + html + '</tbody></table>\n  ' + C.key + '\n' +
      '  <div class="sh-bottom">\n    <div class="sh-dead"><h2>Deadlines</h2><ul>' + g.dl.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>\n' +
      '    <div class="sh-qr"><p class="scan">This county, more detail</p>' + w.AgQR.svg(url, 'QR code for ' + url) + '<p class="url">agsist.com/arc-plc/<br>' + esc(sslug) + '/' + esc(cslug) + '</p></div>\n' +
      '  </div>\n  <p class="sh-foot">General guidance for a typical farm in this county. Your farm&rsquo;s PLC yield can change the answer. Not from FSA.<br>\n' +
      '  <b>Prepared by AGSIST (agsist.com), updated ' + g.upd + '</b></p>\n';
    main.removeAttribute('aria-busy');
    d.documentElement.setAttribute('data-sheet', 'ready');
  }
  function fail() {
    var msg = 'The sheet didn’t load. Check the connection.';
    main.className = 'ap-sheet sh-msg';
    if (w.AgStates) w.AgStates.error(main, { msg: msg, retry: start });
    else { say('<div class="st-msg" role="status"><p>' + esc(msg) + '</p><button type="button" class="st-retry">Try again</button></div>'); main.querySelector('button').onclick = start; }
  }
  function start() {
    main.className = 'ap-sheet sh-msg';
    if (w.AgStates) w.AgStates.skeleton(main, { lines: 10 }); else main.setAttribute('aria-busy', 'true');
    fetch(C.math + st + '.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(paint, fail);
  }
  start();
})(window, document);
