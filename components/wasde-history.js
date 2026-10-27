/* components/wasde-history.js: "How this estimate moved" on /whats-priced-in.
   Every U.S. corn, soybean and wheat balance sheet line, for one market year,
   as each monthly WASDE printed it (read from USDA's own reports in the ESMIS archive, 1973 on).
   The page holds one hidden <details id="how-moved"> and this script (defer).
   It asks for the small index (data/wasde-history/index.json) once the page has
   loaded and shows the section only when the history is there; the crop file
   loads when a reader opens it. A missing index keeps the section hidden; a crop
   file that does not load says so in the section. Market years before 2000/01 sit in one
   file a decade (corn-1990s.json), listed in the crop file's "parts" and loaded only when a
   reader picks one of those years. Share link: ?wh=corn~2026/27~<line>.
   Writes nothing, sends nothing about the reader. Tests: test/wasde-archive.test.mjs. */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BASE = '/data/wasde-history/';

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : String(iso || '');
  }
  function fmtNum(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 'n/a';
    var d = Math.round(v) === v ? 0 : (Math.abs(v) < 10 ? 2 : 1);
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: 3 });
  }
  function fmtUnit(u) {
    u = String(u || '');
    return /\$/.test(u) ? u : u.toLowerCase();
  }
  function fmtChange(now, before) {
    if (typeof before !== 'number') return '';
    var d = Math.round((now - before) * 1000) / 1000;
    if (d === 0) return 'unchanged';
    return (d > 0 ? '+' : '-') + fmtNum(Math.abs(d));
  }
  var FLAG = { 'Proj.': 'projected', 'Est.': 'estimated' };

  /* One line's path: [{date, wasde, flag, value, change}], oldest first. */
  function path(doc, my, si) {
    var y = doc && doc.years && doc.years[my];
    if (!y) return [];
    var flags = {};
    (y.f || []).forEach(function (p) { flags[p[0]] = p[1]; });
    var pts = (y.s && y.s[String(si)]) || [];
    var out = [], prev;
    pts.forEach(function (p) {
      var r = doc.reports[p[0]] || [];
      out.push({ date: r[0], wasde: r[1], flag: FLAG[flags[p[0]]] || '', value: p[1], change: fmtChange(p[1], prev) });
      prev = p[1];
    });
    return out;
  }

  /* Plain summary of one path. */
  function summary(label, my, line, unit, pts) {
    if (!pts.length) return 'No figure on file for this line and year.';
    var a = pts[0], b = pts[pts.length - 1];
    var moved = pts.filter(function (p, i) { return i > 0 && p.change !== 'unchanged'; }).length;
    var s = 'USDA first printed ' + my + ' ' + label.toLowerCase() + ' ' + line.toLowerCase() + ' at ' + fmtNum(a.value) + ' ' + fmtUnit(unit) +
      ' (' + fmtDate(a.date) + ').';
    if (pts.length === 1) return s + ' One report on file so far.';
    var d = b.value - a.value;
    s += ' The latest, ' + fmtDate(b.date) + ', is ' + fmtNum(b.value) + ': ' +
      (d === 0 ? 'the same as the first print' : (d > 0 ? 'up ' : 'down ') + fmtNum(Math.abs(Math.round(d * 1000) / 1000)) +
        (a.value ? ' (' + (d > 0 ? '+' : '-') + Math.abs(d / a.value * 100).toFixed(1) + '%)' : '')) +
      ', changed in ' + moved + ' of ' + (pts.length - 1) + ' later reports.';
    return s;
  }

  /* The decade file that holds market year `my`, when the crop file does not: {name, years} or null. */
  function partFor(doc, my) {
    if (!doc || (doc.years && doc.years[my])) return null;
    var ps = doc.parts || [];
    for (var i = 0; i < ps.length; i++) {
      if (/^[a-z]+-\d{3}0s\.json$/.test(ps[i].name || '') && (ps[i].years || []).indexOf(my) >= 0) return ps[i];
    }
    return null;
  }
  function allYears(doc) {
    var ys = Object.keys(doc.years || {});
    (doc.parts || []).forEach(function (p) { (p.years || []).forEach(function (y) { if (ys.indexOf(y) < 0) ys.push(y); }); });
    return ys.sort().reverse();
  }

  function parseShare(q) {
    var m = /(?:^|[?&])wh=([^&]*)/.exec(q || '');
    if (!m) return null;
    var p;
    try { p = decodeURIComponent(m[1].replace(/\+/g, ' ')).split('~'); } catch (e) { return null; }
    return { crop: p[0] || '', my: p[1] || '', line: p[2] || '' };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function mount(box, index, share, fetchJSON) {
    var body = box.querySelector('[data-wh-body]');
    var crops = Object.keys(index.crops || {});
    var cache = {};
    var selC = el('select'), selY = el('select'), selL = el('select');
    selC.setAttribute('aria-label', 'Crop'); selY.setAttribute('aria-label', 'Market year'); selL.setAttribute('aria-label', 'Balance sheet line');
    crops.forEach(function (c) { var o = el('option', null, index.crops[c].label || c); o.value = c; selC.appendChild(o); });
    var ctl = el('div', 'wh-ctl');
    [['Crop', selC], ['Market year', selY], ['Line', selL]].forEach(function (p) {
      var l = el('label', null, p[0] + ' '); l.appendChild(p[1]); ctl.appendChild(l);
    });
    var out = el('div', 'wh-out');
    var src = body.querySelector('.src');
    body.insertBefore(ctl, src);
    body.insertBefore(out, src);

    function setShare(c, my, line) {
      try {
        var u = new URL(root.location.href);
        u.searchParams.set('wh', [c, my, line].join('~'));
        u.hash = 'how-moved';
        root.history.replaceState(null, '', u.toString());
      } catch (e) { /* share link is a convenience */ }
    }

    function draw() {
      var doc = cache[selC.value];
      var si = +selL.value, my = selY.value;
      var s = doc.series[si] || {};
      var pts = path(doc, my, si);
      out.textContent = '';
      out.appendChild(el('p', 'wh-sum', summary(doc.label, my, s.line || '', s.unit, pts)));
      if (pts.length) {
        var t = el('table', 'wh-tbl'), hd = el('tr');
        ['Report', 'Status', s.line + ' (' + fmtUnit(s.unit) + ')', 'Change'].forEach(function (h) { hd.appendChild(el('th', null, h)); });
        var th = el('thead'); th.appendChild(hd); t.appendChild(th);
        var tb = el('tbody');
        pts.slice().reverse().forEach(function (p) {
          var tr = el('tr');
          tr.appendChild(el('td', null, fmtDate(p.date) + (p.wasde ? ' (WASDE-' + p.wasde + ')' : '')));
          tr.appendChild(el('td', null, p.flag));
          tr.appendChild(el('td', 'n', fmtNum(p.value)));
          tr.appendChild(el('td', 'n', p.change));
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        var wrap = el('div', 'wh-scroll'); wrap.appendChild(t); out.appendChild(wrap);
        var gaps = (index.months_with_no_report_on_file || []).filter(function (m) { return m >= pts[0].date.slice(0, 7) && m <= pts[pts.length - 1].date.slice(0, 7); });
        if (gaps.length) out.appendChild(el('p', 'wh-note', 'No report on file for ' + gaps.map(function (m) { return MON[+m.slice(5) - 1] + ' ' + m.slice(0, 4); }).join(', ') + '.'));
        /* USDA corrected a figure a report carried (data/usda-corrections.json via the builder):
           the table keeps what the WASDE printed; the dated note goes under it. */
        var rn = doc.report_notes || {};
        pts.forEach(function (p) {
          (rn[p.date] || []).forEach(function (x) {
            if ((!x.market_year || x.market_year === my) && (!x.line || x.line === s.line)) out.appendChild(el('p', 'wh-note', fmtDate(p.date) + ': ' + x.note));
          });
        });
      }
      setShare(selC.value, my, s.line || '');
    }

    function fillYears(doc, want) {
      selY.textContent = '';
      var ys = allYears(doc);
      ys.forEach(function (y) { var o = el('option', null, y); o.value = y; selY.appendChild(o); });
      if (want && ys.indexOf(want) >= 0) selY.value = want;
    }
    function fillLines(doc, want) {
      var y = doc.years[selY.value] || { s: {} };
      var keep = selL.value !== '' && doc.series[+selL.value] ? doc.series[+selL.value].line : '';
      selL.textContent = '';
      doc.series.forEach(function (s, i) {
        if (!y.s[String(i)]) return;
        var o = el('option', null, s.line); o.value = String(i); selL.appendChild(o);
      });
      var pick = want || keep || 'Ending Stocks';
      for (var i = 0; i < selL.options.length; i++) {
        if (doc.series[+selL.options[i].value].line === pick) { selL.value = selL.options[i].value; break; }
      }
    }

    /* The year's decade file, when the crop file does not hold it; then the lines and the table. */
    function showYear(doc, line) {
      var p = partFor(doc, selY.value);
      var ready = Promise.resolve();
      if (p) {
        out.textContent = 'Loading the older reports.';
        ready = fetchJSON(BASE + p.name).then(function (part) {
          if (!part || !part.years) throw new Error('bad file');
          Object.keys(part.years).forEach(function (y) { if (!doc.years[y]) doc.years[y] = part.years[y]; });
        });
      }
      return ready.then(function () { fillLines(doc, line); draw(); }).catch(function () {
        out.textContent = 'The older reports did not load just now. Pick the year again to try again.';
      });
    }

    function loadCrop(c, want) {
      if (cache[c]) { fillYears(cache[c], want && want.my); return showYear(cache[c], want && want.line); }
      out.textContent = 'Loading the report history.';
      return fetchJSON(BASE + c + '.json').then(function (doc) {
        if (!doc || !doc.years || !doc.series) throw new Error('bad file');
        cache[c] = doc;
        fillYears(doc, want && want.my);
        return showYear(doc, want && want.line);
      }).catch(function () {
        out.textContent = 'The report history did not load just now. Close and reopen this section to try again.';
        delete cache[c];
      });
    }

    selC.addEventListener('change', function () { selL.value = ''; loadCrop(selC.value); });
    selY.addEventListener('change', function () { showYear(cache[selC.value]); });
    selL.addEventListener('change', draw);
    if (share && crops.indexOf(share.crop) >= 0) selC.value = share.crop;
    loadCrop(selC.value, share);
    return { reload: function () { if (!cache[selC.value]) loadCrop(selC.value); } };
  }

  function init(doc, win) {
    var box = doc.getElementById('how-moved');
    if (!box || !win.fetch) return;
    var fetchJSON = function (u) { return win.fetch(u).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); };
    var share = parseShare(win.location.search);
    fetchJSON(BASE + 'index.json').then(function (index) {
      if (!index || !index.crops || !Object.keys(index.crops).length) return;
      var span = box.querySelector('[data-wh-span]');
      if (span) span.textContent = 'Every report from ' + fmtDate(index.first) + ' through ' + fmtDate(index.through) + '.';
      box.hidden = false;
      var view = null;
      var start = function () { if (!box.open) return; if (view) view.reload(); else view = mount(box, index, share, fetchJSON); };
      box.addEventListener('toggle', start);
      if (share) { box.open = true; start(); }
    }).catch(function () { /* no history published yet: the section stays hidden */ });
  }

  root.agsistWasdeHistory = { path: path, summary: summary, parseShare: parseShare, partFor: partFor, allYears: allYears, fmtNum: fmtNum, fmtDate: fmtDate, fmtChange: fmtChange, init: init };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(document, root); });
    else init(document, root);
  }
})(typeof window !== 'undefined' ? window : globalThis);
