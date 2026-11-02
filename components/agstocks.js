/* /ag-stocks: a company's five-line read and its plants near you, filled on tap.
   Data loads only when a reader opens a company: data/agstocks/sec.json (SEC filings and
   XBRL quarter facts), latest.json (stored Yahoo closes) and plants.json (plants matched by
   operator name). Every line shows a number only when the filing or the stored row has it,
   with its date and a link; nothing is written by a model, nothing is predicted.
   ZIP to a point: the same sharded ZIP table the cash bids page reads (bids data/zips/NN.json).
   Fails soft: a file that does not load says so in the row and the rest of the page works. */
(function () {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var ZIP_BASE = 'https://dnilgis.github.io/bids/';
  var NEAR_MI = 150;
  var KIND = { ethanol: 'ethanol plant', crush: 'soybean crush plant', 'export': 'export grain elevator', rail: 'rail shuttle elevator' };
  var cache = {};

  function get(path) {
    if (!cache[path]) {
      cache[path] = fetch(path, { cache: 'default' }).then(function (r) { return r.ok ? r.json() : null; })['catch'](function () { return null; });
    }
    return cache[path];
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(d, yr) { if (!d) return ''; var m = +d.slice(5, 7), dd = +d.slice(8, 10); return MON[m - 1] + ' ' + dd + (yr === false ? '' : ', ' + d.slice(0, 4)); }
  function big(v) {
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + ' billion';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + ' million';
    return s + '$' + Math.round(a).toLocaleString('en-US');
  }
  function money(v) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(p) { return (p > 0 ? 'up ' : p < 0 ? 'down ' : 'flat, ') + Math.abs(p).toFixed(1) + '%'; }
  function link(url, text) { return esc(text); }  // the filing is named, not linked (no direct links to data sources)
  function filingUrl(cik, accn) { return 'https://www.sec.gov/Archives/edgar/data/' + (+cik) + '/' + String(accn || '').replace(/-/g, '') + '/'; }
  function miles(a, b) {
    var r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function list(months) {
    var w = months.map(function (m) { return MONTH[m - 1]; });
    return w.length < 2 ? w.join('') : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1];
  }

  /* The five lines. Each is pushed only when its numbers exist. */
  function lines(t, rec, q, plants) {
    var out = [];
    rec = rec || {};
    var per = rec.periodic;
    if (per) {
      out.push('Last report: ' + esc(per.form) + (per.period ? ' for the period ended ' + day(per.period) : '') +
        ', filed ' + day(per.filed) + '. ' + link(per.url, 'SEC filing'));
    } else if (rec.sixk) {
      out.push('Latest report to the SEC: 6-K filed ' + day(rec.sixk.filed) + '. ' + link(rec.sixk.url, 'SEC filing'));
    }
    var rv = rec.rev;
    if (rv && rv.cur) {
      var s = 'Revenue, whole company: ' + big(rv.cur.val) + ' in the three months ended ' + day(rv.cur.end);
      if (rv.prior && rv.prior.val) s += ', ' + pct((rv.cur.val / rv.prior.val - 1) * 100) + ' from ' + big(rv.prior.val) + ' a year before';
      out.push(s + '. ' + link(filingUrl(rec.cik, rv.cur.accn), (rv.cur.form || 'filing') + ' filed ' + day(rv.cur.filed)));
    }
    var ni = rec.ni;
    if (ni && ni.cur) {
      var n = 'Net income, whole company: ' + big(ni.cur.val) + ' in the three months ended ' + day(ni.cur.end);
      if (ni.prior) n += ', against ' + big(ni.prior.val) + ' a year before';
      out.push(n + '. ' + link(filingUrl(rec.cik, ni.cur.accn), (ni.cur.form || 'filing') + ' filed ' + day(ni.cur.filed)));
    }
    if (rec.earnings) {
      var e = 'Last earnings release: 8-K filed ' + day(rec.earnings.filed) + ' (' + link(rec.earnings.url, 'SEC filing') + ').';
      if (rec.usual_months && rec.usual_months.length) e += ' Usually reports in ' + list(rec.usual_months) + ' (its 8-K earnings releases, last three years).';
      out.push(e);
    }
    var pl = (plants && plants.plants && plants.plants[t]) || [];
    if (pl.length) {
      var by = {};
      pl.forEach(function (p) { by[p.k] = (by[p.k] || 0) + 1; });
      var parts = Object.keys(by).map(function (k) { return by[k] + ' ' + KIND[k] + (by[k] > 1 ? 's' : ''); });
      out.push('Plants AGSIST lists under its own name: ' + esc(parts.join(', ')) + '.');
    } else if (q && q.hi52 != null) {
      out.push('52-week closing range: ' + money(q.lo52) + ' to ' + money(q.hi52) + ' (Yahoo Finance closes to ' + day(q.d) + ').');
    }
    return out;
  }

  function zipForm(t) {
    var z = '';
    try { z = localStorage.getItem('agsist_zip') || localStorage.getItem('agsist_user_zip') || ''; } catch (e) { }
    return '<form class="ags-zip" data-t="' + esc(t) + '"><label>Its plants near ZIP <input inputmode="numeric" pattern="[0-9]{5}" maxlength="5" autocomplete="postal-code" value="' +
      esc(/^\d{5}$/.test(z) ? z : '') + '"></label> <button type="submit">Show</button></form><div class="ags-near-out" aria-live="polite"></div>';
  }

  function zipPoint(zip) {
    return get(ZIP_BASE + 'data/zips/' + zip.slice(0, 2) + '.json').then(function (tbl) {
      if (!tbl) return null;
      var p = tbl[zip];
      if (p == null) return { unknown: true };
      if (!Array.isArray(p) || p.length < 2 || (+p[0] === 0 && +p[1] === 0)) return null;
      return [+p[0], +p[1]];
    });
  }

  function near(form) {
    var t = form.getAttribute('data-t'), zip = (form.querySelector('input').value || '').trim();
    var out = form.nextElementSibling;
    if (!/^\d{5}$/.test(zip)) { out.textContent = 'Enter a 5-digit ZIP.'; return; }
    out.textContent = 'Looking up ZIP ' + zip + '...';
    Promise.all([zipPoint(zip), get('/data/agstocks/plants.json')]).then(function (a) {
      var pt = a[0], plants = a[1];
      if (!plants) { out.textContent = 'The plant list is not answering right now.'; return; }
      if (!pt) { out.textContent = 'The ZIP lookup is not answering right now.'; return; }
      if (pt.unknown) { out.textContent = 'ZIP not recognized. Check the number.'; return; }
      try { localStorage.setItem('agsist_zip', zip); } catch (e) { }
      var all = (plants.plants[t] || []), placed = all.filter(function (p) { return p.ll; });
      var rows = placed.map(function (p) { return { p: p, mi: miles(pt, p.ll) }; })
        .filter(function (r) { return r.mi <= NEAR_MI; }).sort(function (x, y) { return x.mi - y.mi; });
      var html = rows.length ? '<ul>' + rows.slice(0, 8).map(function (r) {
        var p = r.p;
        return '<li>' + esc(p.town) + ', ' + esc(p.st) + ': ' + esc(KIND[p.k] || p.label) + (p.jv ? ' (joint venture, ' + esc(p.op) + ')' : '') +
          ', about ' + Math.round(r.mi) + ' mi. <small>' + (p.url ? link(p.url, p.src) : esc(p.src)) + '</small></li>';
      }).join('') + '</ul>' : '<p>None of its listed plants within ' + NEAR_MI + ' miles of ' + esc(zip) + '.</p>';
      var unplaced = all.length - placed.length;
      if (unplaced) html += '<p class="ags-note">' + unplaced + ' of its plants have no town point on file and are not in this list.</p>';
      html += '<p class="ags-note">Distance is straight-line from the ZIP center to the plant&rsquo;s town.</p>';
      out.innerHTML = html;
    });
  }

  function open(btn) {
    var row = btn.closest('tr'), t = row.getAttribute('data-t'), det = document.getElementById('d-' + t);
    if (!det) {
      det = document.createElement('tr');
      det.className = 'ags-d';
      det.id = 'd-' + t;
      det.hidden = true;
      det.innerHTML = '<td colspan="4"></td>';
      row.parentNode.insertBefore(det, row.nextSibling);
    }
    var on = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    det.hidden = !on;
    if (!on || det.getAttribute('data-done')) return;
    var cell = det.firstElementChild;
    cell.textContent = 'Loading the filings...';
    Promise.all([get('/data/agstocks/sec.json'), get('/data/agstocks/latest.json'), get('/data/agstocks/plants.json')]).then(function (a) {
      var sec = a[0], latest = a[1], plants = a[2];
      if (!sec) { cell.textContent = 'The filing data is not answering right now. The table above is unaffected.'; return; }
      var rec = (sec.c || {})[t], q = latest && latest.q ? latest.q[t] : null;
      var ls = lines(t, rec, q, plants);
      var h = ls.length ? '<ol>' + ls.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ol>'
        : '<p>No filing numbers on file for ' + esc(t) + ' yet.</p>';
      if (plants && plants.plants && (plants.plants[t] || []).length) h += zipForm(t);
      h += '<p class="ags-note">Numbers from the company&rsquo;s own SEC filings' + (sec.checked ? ', read ' + day(sec.checked.slice(0, 10)) : '') +
        (rec && rec.stale_since ? '; SEC not answering for it since ' + day(rec.stale_since) : '') + '. Not investment advice.</p>';
      cell.innerHTML = h;
      det.setAttribute('data-done', '1');
      var f = cell.querySelector('form.ags-zip');
      if (f) {
        f.addEventListener('submit', function (ev) { ev.preventDefault(); near(f); });
        if (f.querySelector('input').value) near(f);
      }
    });
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button.ags-co');
    if (b) open(b);
  });
  if (typeof window !== 'undefined') window.AgStocks = { lines: lines, miles: miles };
})();
