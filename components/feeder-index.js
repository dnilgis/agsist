/* AGSIST feeder cattle boxes, drawn from /data/feeder-index.json
   (scripts/build_feeder_index.py computes every number; this file only draws).
   Mount points:
     <section data-feeder="index" hidden>  the AGSIST USDA feeder steer index (weekly, national,
                                           700-899 lb steers), its record and its method
     <section data-feeder="rma" hidden>    RMA's daily feeder steer value, the nearby
                                           futures beside it, the difference, a chart
     <section data-feeder="table" hidden>  AGSIST feeder cattle prices, by region and weight
   The view functions between feeder:start and feeder:end are pure, so the tests
   run them on fixture data (test/feeder-index.test.mjs). */
(function () {
  /*feeder:start*/
  var MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CLASS_LABEL = { '400': '400-499 lb', '500': '500-599 lb', '600': '600-699 lb', '700': '700-799 lb', '800': '800-899 lb', '700-899': '700-899 lb' };
  function fxDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function fxLab(s, noYear) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? MONS[+m[2] - 1] + ' ' + (+m[3]) + (noYear ? '' : ', ' + m[1]) : ''; }
  function fxNum(v) { return typeof v === 'number' && isFinite(v); }
  function fxMoney(v) { return '$' + v.toFixed(2); }
  function fxSigned(v) { return (v > 0 ? '+' : v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2); }
  function fxInt(n) { return (n || 0).toLocaleString('en-US'); }
  function fxWeek(w) {
    if (!w) return '';
    var a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w.start || ''), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w.end || '');
    if (!a || !b) return '';
    return MONS[+a[2] - 1] + ' ' + (+a[3]) + ' to ' + (a[2] === b[2] ? '' : MONS[+b[2] - 1] + ' ') + (+b[3]) + ', ' + b[1];
  }
  var RMA_OLD_DAYS = 14;     // an RMA value older than this is held back
  var AUCTION_OLD_DAYS = 16; // a week that ended longer ago than this is held back

  // RMA box. Returns null when there is nothing to draw; {down:true,...} for a
  // source that did not load or is out of date (the page says so in words).
  function rmaView(d, nowMs) {
    if (!d || typeof d !== 'object') return { down: true, msg: 'This value did not load. It is in USDA RMA&rsquo;s own files.' };
    var r = d.rma;
    if (!r || !r.ok || !fxNum(r.value) || r.value <= 0 || !isFinite(fxDay(r.date))) return { down: true, msg: 'USDA RMA&rsquo;s value could not be read on the last run, so nothing is shown.' };
    var age = (nowMs - fxDay(r.date)) / 864e5;
    var old = age > RMA_OLD_DAYS;
    var out = {
      down: false, old: old,
      val: old ? '-' : fxMoney(r.value),
      date: fxLab(r.date),
      meta: old ? ('Latest held: ' + fxLab(r.date) + '. RMA has not posted a newer value, so it is not shown.')
                : ('Ending value, steers 6 to 10 cwt, USDA RMA.'),
      label: r.label || '',
      basis: r.basis_note || '',
      fut: null, diff: null, futNote: ''
    };
    if (!old && r.fut && fxNum(r.fut.settle) && fxNum(r.diff)) {
      out.fut = 'RMA minus ' + (r.fut.ticker || 'nearby') + ' settle ' + fxMoney(r.fut.settle);
      out.diff = fxSigned(r.diff);
      out.diffWord = r.diff > 0 ? 'over' : r.diff < 0 ? 'under' : 'even with';
    } else if (!old) {
      out.futNote = 'No futures settle held for ' + fxLab(r.date, true) + '.';
    }
    var h = (r.hist || []).filter(function (p) { return p && fxNum(p[1]) && isFinite(fxDay(p[0])); });
    out.hist = h;
    if (h.length >= 20) {
      var lo = h[0], hi = h[0];
      h.forEach(function (p) { if (p[1] < lo[1]) lo = p; if (p[1] > hi[1]) hi = p; });
      out.range = 'Since ' + fxLab(h[0][0]) + ': low ' + fxMoney(lo[1]) + ' on ' + fxLab(lo[0]) + ', high ' + fxMoney(hi[1]) + ' on ' + fxLab(hi[0]) + ' (' + h.length + ' days with a value).';
    }
    return out;
  }

  // One cell of the AGSIST table.
  function cellView(o, gates) {
    if (!o) return { p: '-', chg: '', n: 'no sales', withheld: true };
    var n = o.barns ? (fxInt(o.barns) + (o.barns === 1 ? ' barn, ' : ' barns, ') + fxInt(o.head) + ' head') : 'no sales';
    if (!fxNum(o.p)) return { p: '-', chg: '', n: n, withheld: true, why: o.barns ? 'too few sales' : 'no sales' };
    var chg = '';
    if (fxNum(o.chg)) chg = fxSigned(o.chg);
    else if (fxNum(o.prev)) chg = 'fewer than ' + gates.barns + ' barns both weeks';
    else chg = 'prior week too few sales';
    return { p: fxMoney(o.p), chg: chg, chgNum: fxNum(o.chg) ? o.chg : null, n: n, withheld: false };
  }

  function tableView(d, sex, region, nowMs) {
    if (!d || typeof d !== 'object') return { down: true, msg: 'The weekly sale barn prices did not load.' };
    var a = d.auction;
    if (!a || !a.table || !a.week) return { down: true, msg: 'The weekly sale barn prices could not be built on the last run.' };
    var age = (nowMs - fxDay(a.week.end)) / 864e5;
    if (!(age <= AUCTION_OLD_DAYS)) return { down: true, msg: 'No new USDA barn reports have been read since the week of ' + fxWeek(a.week) + ', so the table is held back. The barn list below still shows each barn&rsquo;s own latest sale.' };
    var t = a.table[sex] || {};
    var reg = null;
    (a.regions || []).forEach(function (r) { if (r.id === region) reg = r; });
    if (!reg) reg = (a.regions || [])[0] || { id: 'us', name: 'All barns', states: [] };
    var row = t[reg.id] || {};
    var gates = a.gates || { barns: 3, head: 300 };
    var rows = ['400', '500', '600', '700', '800'].map(function (c) { var v = cellView(row[c], gates); v.cls = CLASS_LABEL[c]; return v; });
    var shown = rows.filter(function (r) { return !r.withheld; }).length;
    return {
      down: false,
      title: a.name || 'AGSIST feeder cattle prices, by region and weight',
      week: fxWeek(a.week), prior: fxWeek(a.prior),
      region: reg.name, states: (reg.states || []).join(', '),
      rows: rows, shown: shown,
      gates: 'A price shows when ' + gates.barns + ' or more barns sold ' + fxInt(gates.head) + ' or more head in that class that week; otherwise it says too few sales.'
    };
  }

  // The AGSIST USDA feeder steer index box: the latest finished week, its sample,
  // how far a redraw of its barns moves it, the change when earned, RMA beside it.
  // hist: data/feeder-index-history.json (past weeks from archived USDA reports), loaded when the
  // fold opens; its weeks come before the live record and never replace a live week.
  function indexView(d, nowMs, hist) {
    if (!d || typeof d !== 'object') return { down: true, msg: 'The index did not load.' };
    var ix = d.index;
    var ws = ix && ix.weeks;
    if (!ws || !ws.length) return { down: true, msg: 'The index could not be built on the last run.' };
    var w = ws[ws.length - 1];
    var age = (nowMs - fxDay(w.end)) / 864e5;
    if (!(age <= AUCTION_OLD_DAYS)) return { down: true, msg: 'No new USDA barn reports have been read since the week of ' + fxWeek(w) + ', so the index is held back.' };
    var g = ix.gates || {};
    var top = (w.top || []).map(function (t) { return t[0] + ' ' + t[1] + '%'; }).join(', ');
    var out = {
      down: false,
      label: ix.label || 'AGSIST USDA feeder steer index, not the CME index',
      week: fxWeek(w),
      withheld: !fxNum(w.p),
      val: fxNum(w.p) ? fxMoney(w.p) : '-',
      n: fxInt(w.barns) + (w.barns === 1 ? ' barn' : ' barns') + ' in ' + fxInt(w.states) + (w.states === 1 ? ' state' : ' states') + ', ' + fxInt(w.head) + ' head' + (fxNum(w.avg_wt) ? ', average ' + fxInt(w.avg_wt) + ' lb' : ''),
      top: top ? 'Largest shares of the head: ' + top + '.' : '',
      why: (w.why || []).join('; '),
      range: '', chgHead: '', chgLine: '', chgRange: '', last: '', check: '',
      first: w.final ? '' : 'First count. USDA reports filed late can still add sales to this week for ' + (ix.final_days || 10) + ' days after it ends.',
      gates: 'A week shows when ' + g.barns + ' or more barns in ' + g.states + ' or more states sold ' + fxInt(g.head) + ' or more head, and no one state sold more than ' + g.max_state_pct + '% of them. Otherwise it is withheld, with its counts.'
    };
    if (!out.withheld && fxNum(w.lo) && fxNum(w.hi)) out.range = 'Redraw this week&rsquo;s barns at random and it lands from ' + fxMoney(w.lo) + ' to ' + fxMoney(w.hi) + ' nine times in ten.';
    if (out.withheld) {
      out.why = 'Withheld: ' + (out.why || 'too few sales') + '.';
      if (ix.last_ok) ws.forEach(function (x) { if (x.start === ix.last_ok && fxNum(x.p)) out.last = 'Last week with a figure: ' + fxWeek(x) + ', ' + fxMoney(x.p) + '.'; });
    } else if (fxNum(w.chg) && fxNum(w.chg_lo) && fxNum(w.chg_hi)) {
      out.chgHead = w.move === 'up' ? 'Higher than the week before' : w.move === 'down' ? 'Lower than the week before' : 'No clear change from the week before';
      out.chgLine = fxSigned(w.chg) + '.';
      out.chgRange = 'Redrawing the barns of both weeks puts the change at ' + fxSigned(w.chg_lo) + ' to ' + fxSigned(w.chg_hi) + ' (' + fxInt(w.both) + ' barns sold both weeks).';
      out.chgNum = w.chg; out.move = w.move;
    } else {
      out.chgLine = 'No change shown: ' + (w.chg_why || 'not enough of the same barns both weeks') + '.';
    }
    var c = d.check;
    if (!out.withheld && c && c.week === w.start && fxNum(c.rma)) {
      out.check = fxNum(c.gap)
        ? 'RMA&rsquo;s steer value beside it averaged ' + fxMoney(c.rma) + ' over the ' + c.rma_days + ' days RMA posted that week; the index ran ' + fxSigned(c.gap) + ' against it.'
        : 'Set beside RMA&rsquo;s steer value once RMA has posted 3 days of that week (it has posted ' + c.rma_days + ').';
    }
    // the record, oldest first; withheld weeks stay in as gaps
    var past = [];
    if (hist && hist.weeks && hist.weeks.length) past = hist.weeks.filter(function (x) { return x && x.start < ws[0].start && x.from === 'archive'; });
    // the chart starts at the first archived week with a figure; the table lists the live weeks
    // and the archived weeks that have a figure (an archived withheld week is a gap in the chart only)
    var firstOk = -1;
    past.forEach(function (x, i) { if (firstOk < 0 && fxNum(x.p)) firstOk = i; });
    var all = (firstOk >= 0 ? past.slice(firstOk) : []).concat(ws);
    var listed = past.filter(function (x) { return fxNum(x.p); }).concat(ws);
    out.series = all.map(function (x) { return { start: x.start, p: fxNum(x.p) ? x.p : null, lo: fxNum(x.lo) ? x.lo : null, hi: fxNum(x.hi) ? x.hi : null }; });
    out.shownWeeks = out.series.filter(function (x) { return x.p != null; }).length;
    out.rows = listed.slice(-12).reverse().map(function (x) {
      return { week: fxWeek(x), p: fxNum(x.p) ? fxMoney(x.p) : '-', chg: fxNum(x.chg) ? fxSigned(x.chg) : '', arch: x.from === 'archive',
        n: fxInt(x.barns) + ' barns, ' + fxInt(x.states) + ' states, ' + fxInt(x.head) + ' head', why: fxNum(x.p) ? '' : (x.why || []).join('; ') };
    });
    out.liveSince = ix.start ? fxLab(ix.start) : '';
    out.since = fxLab(all[0].start);
    out.archive = past.length ? { since: fxLab(past[0].start), read: fxLab(hist.read), ok: past.filter(function (x) { return fxNum(x.p); }).length, weeks: past.length,
      // how each past week was read: through USDA My Market News (via.mars) or, for a barn week it
      // lacked, from an Internet Archive copy (via.archive; a file without via is archive copies only)
      mars: past.some(function (x) { return x.via && x.via.mars > 0; }),
      iaWeeks: past.filter(function (x) { return x.via ? x.via.archive > 0 : x.barns > 0; }).length } : null;
    // how this week's barns were read (Nov 3 2026): through USDA My Market News (via.mars) or, for a
    // barn whose week My Market News did not have yet, from the barn's own USDA report file (via.pdf)
    out.liveVia = w.via && (w.via.mars > 0) ? { mars: fxInt(w.via.mars), pdf: w.via.pdf > 0 ? fxInt(w.via.pdf) : '' } : null;
    out.minBarns = g.barns; out.draws = fxInt(ix.draws || 1000);
    return out;
  }
  /*feeder:end*/

  if (typeof document === 'undefined') return;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Drawn at the box's own pixel width, so labels stay 11px on a phone and on a desktop.
  function geo(w) { var W = Math.max(280, Math.round(w || 640)); return { W: W, H: Math.round(Math.min(220, Math.max(140, W * 0.3))), L: 42, R: 6, T: 10, B: 22 }; }
  function chartSvg(hist, w) {
    if (!hist || hist.length < 20) return '';
    var g = geo(w), W = g.W, H = g.H, L = g.L, R = g.R, T = g.T, B = g.B;
    var vals = hist.map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.08 || 5; lo -= pad; hi += pad;
    var x = function (i) { return L + (W - L - R) * i / (hist.length - 1); };
    var y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var path = hist.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join('');
    var ticks = [lo + pad, (lo + hi) / 2, hi - pad];
    var grid = ticks.map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="fx-grid"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" class="fx-ax">$' + Math.round(v) + '</text>';
    }).join('');
    var first = hist[0][0], last = hist[hist.length - 1][0];
    return '<svg class="fx-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="RMA feeder steer value, ' + esc(fxLab(first)) + ' to ' + esc(fxLab(last)) + '">' +
      grid + '<path d="' + path + '" class="fx-line"/>' +
      '<text x="' + L + '" y="' + (H - 6) + '" class="fx-ax">' + esc(fxLab(first)) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" class="fx-ax">' + esc(fxLab(last)) + '</text>' +
      '<line class="fx-cross" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/>' +
      '<circle class="fx-dot" r="4" cx="0" cy="0" visibility="hidden"/>' +
      '<rect class="fx-hit" x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent"/></svg>' +
      '<p class="fx-tip" aria-hidden="true"></p>';
  }

  function wireChart(box, hist, w) {
    var svg = box.querySelector('.fx-chart'); if (!svg) return;
    var hit = svg.querySelector('.fx-hit'), cross = svg.querySelector('.fx-cross'), dot = svg.querySelector('.fx-dot'), tip = box.querySelector('.fx-tip');
    var g = geo(w), W = g.W, H = g.H, L = g.L, R = g.R, T = g.T, B = g.B;
    var vals = hist.map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.08 || 5; lo -= pad; hi += pad;
    function at(ev) {
      var r = svg.getBoundingClientRect(); if (!r.width) return;
      var px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * W / r.width;
      var i = Math.max(0, Math.min(hist.length - 1, Math.round((px - L) / (W - L - R) * (hist.length - 1))));
      var cx = L + (W - L - R) * i / (hist.length - 1), cy = T + (H - T - B) * (1 - (hist[i][1] - lo) / (hi - lo));
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
      tip.textContent = fxLab(hist[i][0]) + ': ' + fxMoney(hist[i][1]);
    }
    function off() { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.textContent = ''; }
    hit.addEventListener('mousemove', at); hit.addEventListener('touchstart', at, { passive: true }); hit.addEventListener('touchmove', at, { passive: true });
    hit.addEventListener('mouseleave', off);
  }

  var CSS = '.fx{border:1px solid var(--border);border-radius:var(--r-lg);background:var(--surface);padding:.85rem 1.1rem;margin:0 0 .6rem}' +
    '.fx h2,.fx h3{margin:0 0 .15rem;font-size:1.08rem;color:var(--text)}' +
    '.fx .fx-lbl{font-size:.78rem;text-transform:none;letter-spacing:0;color:var(--text-muted,var(--text-dim));font-weight:700;margin:0}' +
    '.fx .fx-sub{margin:0 0 .5rem;font-size:.86rem;color:var(--text-muted,var(--text-dim))}' +
    '.fx .fx-val{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:1.9rem;line-height:1.1;margin:.15rem 0 0;color:var(--text)}' +
    '.fx .fx-val small{font-size:.8rem;font-weight:400;color:var(--text-muted,var(--text-dim))}' +
    '.fx .fx-row{display:flex;flex-wrap:wrap;gap:.3rem 1.2rem;margin:.4rem 0;font-size:.9rem}' +
    '.fx .fx-row b{font-family:"JetBrains Mono",monospace}' +
    '.fx .fx-note{font-size:.84rem;color:var(--text-muted,var(--text-dim));margin:.25rem 0;line-height:1.45}' +
    '.fx .fx-src{font-size:.8rem;color:var(--text-muted,var(--text-dim));margin:.5rem 0 0;line-height:1.5}' +
    '.fx .fx-src a{text-decoration:underline}' +
    '.fx .fx-down{font-size:.9rem;color:var(--text-dim);margin:.2rem 0}' +
    '.fx .fx-chart{display:block;width:100%;height:auto;margin:.5rem 0 0;touch-action:pan-y}' +
    '.fx .fx-line{fill:none;stroke:var(--gold,#d4a23f);stroke-width:2;stroke-linejoin:round}' +
    '.fx .fx-grid{stroke:var(--border);stroke-width:1}' +
    '.fx .fx-ax{fill:var(--text-muted,var(--text-dim));font-size:11px}' +
    '.fx .fx-cross{stroke:var(--text-muted,var(--text-dim));stroke-width:1;stroke-dasharray:3 3}' +
    '.fx .fx-dot{fill:var(--gold,#d4a23f);stroke:var(--surface);stroke-width:2}' +
    '.fx .fx-tip{min-height:1.2em;margin:.1rem 0 0;font-family:"JetBrains Mono",monospace;font-size:.82rem;color:var(--text)}' +
    '.fx details{margin:.3rem 0 0;font-size:.86rem}.fx summary{cursor:pointer;font-weight:600;color:var(--text)}' +
    '.fx details ul{padding-left:1.1rem;margin:.4rem 0}.fx details li{margin:.2rem 0;color:var(--text-dim)}' +
    '.fx .fx-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;max-width:100%;margin:0 .5rem .5rem 0}' +
    '.fx .fx-seg button{min-height:40px;padding:0 .7rem;border:0;background:var(--surface);color:var(--text-dim);font:inherit;font-size:.86rem;font-weight:700;cursor:pointer}' +
    '.fx .fx-seg button+button{border-left:1px solid var(--border)}' +
    '.fx .fx-seg button[aria-pressed="true"]{background:var(--gold-fill,var(--gold));color:#111}' +
    '.fx .fx-t{border-collapse:collapse;width:100%;font-size:.88rem;margin:.2rem 0 .4rem}' +
    '.fx .fx-t th,.fx .fx-t td{padding:.4rem .4rem;border-bottom:1px solid var(--border);text-align:right;vertical-align:top}' +
    '.fx .fx-t th:first-child,.fx .fx-t td:first-child{text-align:left;white-space:nowrap}' +
    '.fx .fx-t thead th{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted,var(--text-dim))}' +
    '.fx .fx-t td.p{font-family:"JetBrains Mono",monospace;font-weight:700;color:var(--text)}' +
    '.fx .fx-t td small{display:block;font-size:.74rem;color:var(--text-muted,var(--text-dim));font-weight:400;font-family:var(--font-body,Inter,system-ui,sans-serif)}' +
    '.fx .fx-t td.c{font-family:"JetBrains Mono",monospace}.fx .fx-t td.c.up{color:var(--green)}.fx .fx-t td.c.dn{color:var(--red)}' +
    '.fx .fx-bar{stroke:var(--gold,#d4a23f);stroke-width:5;stroke-linecap:round;opacity:.3}' +
    '.fx .fx-pt{fill:var(--gold,#d4a23f);stroke:var(--surface);stroke-width:1.5}' +
    '.fx .fx-mv.up{color:var(--green)}.fx .fx-mv.dn{color:var(--red)}' +
    '.fx-pair{display:grid;gap:.6rem;margin:0 0 .6rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));align-items:start}.fx-pair>.fx{margin:0}' +
    '@media(max-width:480px){.fx{padding:.7rem .7rem}.fx .fx-t{font-size:.82rem}.fx .fx-t th,.fx .fx-t td{padding:.35rem .25rem}.fx .fx-val{font-size:1.7rem}}';

  function injectCss() {
    if (document.getElementById('fx-css')) return;
    var s = document.createElement('style'); s.id = 'fx-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  var RMA_CREDIT = 'Source: USDA RMA, Livestock Risk Protection actual ending values. Futures settles: CME feeder cattle futures via Yahoo Finance, the settle after the close. ' +
    'RMA LRP Handbook FCIC-20010, section 23C.';
  var AMS_CREDIT = 'Source: USDA AMS auction reports (Livestock, Poultry and Grain Market News), as read for this page. Prices are AGSIST&rsquo;s sums of USDA&rsquo;s rows.';

  function drawRma(box, d) {
    var v = rmaView(d, Date.now());
    var compact = box.getAttribute('data-compact') === '1';
    var h = '<h2 class="fx-lbl">Feeder steers, RMA LRP value</h2>';
    if (!v || v.down) {
      box.innerHTML = h + '<p class="fx-down">' + (v ? v.msg : '') + '</p>';
      box.hidden = false; return;
    }
    h += '<div class="fx-val">' + v.val + (v.old ? '' : ' <small>$/cwt &middot; ' + v.date + '</small>') + '</div>';
    /* Nov 2: what the value is and its gap to the futures settle sit in the fold below, so /cattle-futures-prices
       stays under its 8,000 px phone cap (test/price-local) with room for the state basis line and new data. */
    // no settle for this date: said in the fold below, not on the card (keeps the cattle page short on phones)
    box.hidden = false;
    var cs = window.getComputedStyle ? getComputedStyle(box) : null;
    var cw = box.clientWidth ? box.clientWidth - (cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 36) : 640;
    h += '<details><summary>' + (!compact && !v.old && v.hist.length >= 20 ? 'The past year, and what this number is' : 'What this number is') + '</summary>';
    h += '<p class="fx-note">' + v.meta + '</p>';
    if (v.fut) h += '<p class="fx-note">' + esc(v.fut) + ': <b>' + esc(v.diff) + '</b></p>';
    if (!compact && !v.old && v.hist.length >= 20) {
      h += chartSvg(v.hist, cw);
      if (v.range) h += '<p class="fx-note">' + v.range + '</p>';
    }
    h += '<ul>' +
      '<li>' + esc(v.label) + '. ' + v.basis + '</li>' +
      '<li>The handbook says RMA applies each type&rsquo;s price adjustment factor before it publishes. This is the type with a factor of 1.00: steers, 6 to 10 cwt. Heifers and lighter steers are this value times their factor.</li>' +
      '<li>Dated by the end date RMA gives it. RMA posts it a few business days later, so the newest value lags the board.</li>' +
      '<li>The difference is RMA&rsquo;s value minus the nearby feeder futures settle on the same date, only on days we hold that settle (we keep them from Oct 15, 2026 on).' + (v.futNote ? ' ' + v.futNote : '') + '</li>' +
      '</ul><p class="fx-src">' + RMA_CREDIT + '</p></details>';
    box.innerHTML = h; box.hidden = false;
    if (!compact && !v.old) wireChart(box, v.hist, cw);
  }

  // The index record: one dot per published week with its redrawn range as a bar,
  // a line only between weeks next to each other, withheld weeks left as gaps.
  function indexChartSvg(series, w) {
    var pts = []; series.forEach(function (x, i) { if (x.p != null) pts.push(i); });
    if (pts.length < 2) return '';
    var g = geo(w), W = g.W, H = g.H, L = g.L, R = g.R + 8, T = g.T, B = g.B;
    var lo = Infinity, hi = -Infinity;
    series.forEach(function (x) { if (x.p == null) return; lo = Math.min(lo, x.lo != null ? x.lo : x.p); hi = Math.max(hi, x.hi != null ? x.hi : x.p); });
    var pad = (hi - lo) * 0.1 || 5; lo -= pad; hi += pad;
    var n = series.length;
    var x = function (i) { return n === 1 ? (L + W - R) / 2 : L + 8 + (W - L - R - 16) * i / (n - 1); };
    var y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var ticks = [lo + pad, (lo + hi) / 2, hi - pad];
    var out = ticks.map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - g.R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="fx-grid"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" class="fx-ax">$' + Math.round(v) + '</text>';
    }).join('');
    var path = '';
    series.forEach(function (s, i) {
      if (s.p == null) return;
      path += (i > 0 && series[i - 1].p != null ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s.p).toFixed(1);
    });
    out += '<path d="' + path + '" class="fx-line"/>';
    series.forEach(function (s, i) {
      if (s.p == null) return;
      if (s.lo != null && s.hi != null) out += '<line class="fx-bar" x1="' + x(i).toFixed(1) + '" x2="' + x(i).toFixed(1) + '" y1="' + y(s.lo).toFixed(1) + '" y2="' + y(s.hi).toFixed(1) + '"/>';
      out += '<circle class="fx-pt" r="3.5" cx="' + x(i).toFixed(1) + '" cy="' + y(s.p).toFixed(1) + '"><title>' + esc(fxLab(s.start)) + ': ' + fxMoney(s.p) + '</title></circle>';
    });
    var a = series[0].start, b = series[n - 1].start;
    out += '<text x="' + x(0).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="start" class="fx-ax">Week of ' + esc(fxLab(a, true)) + '</text>' +
      '<text x="' + (W - g.R) + '" y="' + (H - 6) + '" text-anchor="end" class="fx-ax">' + esc(fxLab(b)) + '</text>';
    return '<svg class="fx-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="AGSIST USDA feeder steer index by week, ' + esc(fxLab(a)) + ' to ' + esc(fxLab(b)) + ', with the range from redrawing each week&rsquo;s barns">' + out + '</svg>';
  }

  function drawIndex(box, d) {
    var v = indexView(d, Date.now());
    var compact = box.getAttribute('data-compact') === '1';
    var h = '<h2 class="fx-lbl">' + esc(v && v.label ? v.label : 'AGSIST USDA feeder steer index, not the CME index') + '</h2>';
    if (!v || v.down) {
      box.innerHTML = h + '<p class="fx-down">' + (v ? v.msg : '') + '</p><p class="fx-src">' + AMS_CREDIT + '</p>';
      box.hidden = false; return;
    }
    h += '<div class="fx-val">' + v.val + ' <small>$/cwt</small></div>' +
      '<p class="fx-note">700 to 899 lb steers, ' + esc(v.week) + ': ' + esc(String(v.n).replace(/, average [\d,]+ lb$/, '')) + '.</p>';
    if (v.withheld) {
      h += '<p class="fx-note"><b>' + esc(v.why) + '</b>' + (v.last ? ' ' + esc(v.last) : '') + '</p>';
    } else {
      if (v.chgHead) h += '<p class="fx-note"><b class="fx-mv' + (v.move === 'up' ? ' up' : v.move === 'down' ? ' dn' : '') + '">' + esc(v.chgHead) + ':</b> ' + esc(v.chgLine) + '</p>';
      else h += '<p class="fx-note">' + esc(v.chgLine) + '</p>';
    }
    box.hidden = false;
    var cs = window.getComputedStyle ? getComputedStyle(box) : null;
    var cw = box.clientWidth ? box.clientWidth - (cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 36) : 640;
    h += '<details>' + indexFold(v, cw, compact) + '</details><p class="fx-src">Source: USDA AMS sale barn reports.</p>';
    box.innerHTML = h; box.hidden = false;
    // Past weeks from archived reports load only when the fold opens (the page payload stays as it was).
    var det = box.querySelector('details');
    if (det) det.addEventListener('toggle', function () {
      if (!det.open || det.getAttribute('data-hist')) return;
      det.setAttribute('data-hist', 'loading');
      fetch('/data/feeder-index-history.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (hd) {
        det.setAttribute('data-hist', hd ? 'loaded' : 'failed');
        if (!hd) return;
        var v2 = indexView(d, Date.now(), hd);
        if (!v2 || v2.down || !v2.archive) return;
        det.innerHTML = indexFold(v2, cw, compact);
      });
    });
  }
  function indexFold(v, cw, compact) {
    var chart = !compact && v.shownWeeks >= 2;
    var h = '<summary>' + (chart ? 'Every week since ' + esc(v.since) + ', and how it is figured' : 'How it is figured, and every week') + '</summary>';
    if (chart) h += indexChartSvg(v.series, cw) + '<p class="fx-note">Dots are the index; the bar through each is the range from redrawing that week&rsquo;s barns. Gaps are withheld weeks.</p>';
    else if (!compact) h += '<p class="fx-note">The chart starts once two weeks have a figure.</p>';
    if (v.range) h += '<p class="fx-note">' + v.range + (v.top ? ' ' + esc(v.top) : '') + '</p>';
    h += '<p class="fx-note">Feeder steers 700 to 899 lb, Medium and Large 1 and 1-2, at USDA-reported sale barns: ' + esc(v.n) + '.</p>';
    if (v.chgRange) h += '<p class="fx-note">' + esc(v.chgRange) + '</p>';
    if (v.check && !v.withheld) h += '<p class="fx-note">' + v.check + '</p>';
    /* the change's range, the RMA comparison (RMA's own box sits beside this one) and the "first count" note sit in the fold (Nov 2): on a phone the open box pushed
       /cattle-futures-prices past its 8,000 px limit (test/price-local) */
    if (v.first) h += '<p class="fx-note">' + esc(v.first) + '</p>';
    h += '<table class="fx-t"><thead><tr><th scope="col">Week</th><th scope="col">Index</th><th scope="col">Change</th></tr></thead><tbody>';
    v.rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.week) + '</td><td class="p">' + esc(r.p) + '<small>' + esc(r.n) + '</small>' + (r.why ? '<small>Withheld: ' + esc(r.why) + '</small>' : '') + (r.arch ? '<small>From archived USDA reports</small>' : '') + '</td><td class="c">' + esc(r.chg) + '</td></tr>';
    });
    h += '</tbody></table><ul>' +
      '<li>What: one national weekly price for feeder steers 700 to 899 lb, graded Medium and Large 1 and 1-2, in dollars per hundredweight. That is the yearling that goes on feed, and the weight RMA&rsquo;s steer value covers.</li>' +
      '<li>From: every USDA AMS report for a single sale barn that we read. USDA&rsquo;s state summaries are left out so no sale counts twice. Rows USDA marks with a note (fleshy, thin, unweaned and the like) are left out.</li>' +
      '<li>How: the dollars paid divided by the hundredweights sold, for every such steer that week, Monday to Sunday by sale date. Heavier lots weigh more.</li>' +
      '<li>' + esc(v.gates) + '</li>' +
      '<li>The range: we redraw the week&rsquo;s barns at random, with repeats, ' + v.draws + ' times and give the middle nine of ten results. A change from the week before shows only when both weeks pass and ' + v.minBarns + ' or more of the same barns sold both weeks; if its range takes in zero, it is called no clear change.</li>' +
      '<li>Weekly, not daily: each barn sells on its own day, so a daily figure would be a different set of barns each day, and some USDA reports come in days late.</li>' +
      '<li>The barns are the ones USDA reports on and we read, so states with more of them count for more. It is not every sale in the country.</li>' +
      (v.liveVia ? '<li>Read: the week of ' + esc(v.week) + ', '  + esc(v.liveVia.mars) + ' barns were read through USDA&rsquo;s My Market News' +
        (v.liveVia.pdf ? ' and ' + esc(v.liveVia.pdf) + ' from the barn&rsquo;s own USDA report, where My Market News did not have that week yet' : '') +
        '. A sale USDA put out twice (a first issue, then the final) counts once.</li>' : '') +
      (v.archive && v.archive.mars
        ? '<li>Our own reads start the week of ' + esc(v.liveSince) + '. The weeks before that, back to the week of ' + esc(v.archive.since) + ', are figured by the same rules from the same USDA barn reports, read through USDA&rsquo;s My Market News (read ' + esc(v.archive.read) + ')' +
          (v.archive.iaWeeks ? '; in ' + fxInt(v.archive.iaWeeks) + ' of those weeks a few barns come from copies of the reports the Internet Archive kept, where My Market News did not have that barn&rsquo;s week' : '') +
          '. ' + fxInt(v.archive.ok) + ' of ' + fxInt(v.archive.weeks) + ' weeks have a figure; the others are withheld by the same rule and are gaps in the chart.</li>'
        : v.archive
        ? '<li>Our own reads start the week of ' + esc(v.liveSince) + '. The weeks before that, back to the week of ' + esc(v.archive.since) + ', are figured by the same rules from copies of USDA&rsquo;s own reports that the Internet Archive kept (read ' + esc(v.archive.read) + '). Those copies catch only some barns in a given week, so most of those weeks are withheld: ' + fxInt(v.archive.ok) + ' of ' + fxInt(v.archive.weeks) + ' have a figure, and only those are in the table.</li>'
        : '<li>Our record starts the week of ' + esc(v.liveSince) + ', when we began reading these reports. Every finished week is kept.</li>') +
      '<li>This is AGSIST&rsquo;s own figure. It is not the CME Feeder Cattle Index, and no CME data goes into it.</li>' +
      '</ul><p class="fx-src">' + AMS_CREDIT + (v.liveVia ? ' Our weeks: read through USDA My Market News.' : '') + (v.archive ? (v.archive.mars ? ' Earlier weeks: USDA AMS reports read through My Market News' + (v.archive.iaWeeks ? ', a few from copies kept by the Internet Archive' : '') + '.' : ' Earlier weeks: USDA AMS reports as copied by the Internet Archive.') : '') + '</p>';
    return h;
  }

  function drawTable(box, d) {
    var state = { sex: 'steers', region: 'us' };
    function render() {
      var v = tableView(d, state.sex, state.region, Date.now());
      var h = '<h2>AGSIST feeder cattle prices, by region and weight</h2>';
      if (!v || v.down) {
        box.innerHTML = h + '<p class="fx-down">' + (v ? v.msg : '') + '</p><p class="fx-src">' + AMS_CREDIT + '</p>';
        box.hidden = false; return;
      }
      h += '<p class="fx-sub">Week of ' + esc(v.week) + '. A weekly average of USDA-reported sales at the barns this page reads. Our own figure, not the CME Feeder Cattle Index.</p>';
      h += '<span class="fx-seg" role="group" aria-label="Steers or heifers">' +
        ['steers', 'heifers'].map(function (s) { return '<button type="button" data-fx-sex="' + s + '" aria-pressed="' + (state.sex === s) + '">' + (s === 'steers' ? 'Steers' : 'Heifers') + '</button>'; }).join('') + '</span>';
      h += '<span class="fx-seg" role="group" aria-label="Region">' +
        (d.auction.regions || []).map(function (r) { return '<button type="button" data-fx-reg="' + esc(r.id) + '" aria-pressed="' + (state.region === r.id) + '">' + esc(r.name) + '</button>'; }).join('') + '</span>';
      h += '<table class="fx-t"><caption class="fx-note" style="caption-side:top;text-align:left">' + esc(v.region) + (v.states ? ' (barns in ' + esc(v.states) + ')' : '') + ', ' + state.sex + ', Medium and Large 1 and 1-2, $/cwt</caption>' +
        '<thead><tr><th scope="col">Weight</th><th scope="col">Price</th><th scope="col">Vs week before</th></tr></thead><tbody>';
      v.rows.forEach(function (r) {
        var cc = r.chgNum == null ? '' : (r.chgNum > 0 ? ' up' : r.chgNum < 0 ? ' dn' : '');
        h += '<tr><td>' + esc(r.cls) + '</td>' +
          '<td class="p">' + (r.withheld ? '-<small>' + esc(r.why || 'no sales') + '</small>' : esc(r.p)) + '<small>' + esc(r.n) + '</small></td>' +
          '<td class="c' + cc + '">' + (r.chgNum == null ? '<small>' + esc(r.withheld ? '' : r.chg) + '</small>' : esc(r.chg)) + '</td></tr>';
      });
      h += '</tbody></table>';
      h += '<p class="fx-note">700 to 899 lb steers, all barns, is the AGSIST USDA feeder steer index, with its own rule for when a week shows.</p>';
      h += '<details><summary>How this is figured</summary><ul>' +
        '<li>Every feeder steer and heifer row USDA reported at a single barn that week, Medium and Large 1 and 1-2 together, priced per cwt on actual weight. Rows USDA marks with a note (value added, fleshy, thin, unweaned and the like) are left out.</li>' +
        '<li>Weighted by pounds sold (head times weight), so the price is dollars over hundredweight sold, the same way the barn tables below add rows.</li>' +
        '<li>A week runs Monday to Sunday by sale date. The table shows the latest week that has ended; a report USDA files late is added when it is read.</li>' +
        '<li>' + v.gates + ' The change shows only when both weeks have a price and ' + ((d.auction.gates || {}).barns || 3) + ' or more of the same barns sold in that class both weeks, because a different mix of barns can move the average more than the market did.</li>' +
        '<li>USDA&rsquo;s state summaries are left out, so no sale is counted twice. All barns includes states not in a region.</li>' +
        '<li>Regions by the barn&rsquo;s state: ' + (d.auction.regions || []).filter(function (r) { return r.id !== 'us'; }).map(function (r) { return esc(r.name) + ' (' + esc((r.states || []).join(', ') || 'none reporting') + ')'; }).join('; ') + '.</li>' +
        '</ul></details>';
      h += '<p class="fx-src">' + AMS_CREDIT + '</p>';
      box.innerHTML = h; box.hidden = false;
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button'); if (!b || !box.contains(b)) return;
      if (b.hasAttribute('data-fx-sex')) state.sex = b.getAttribute('data-fx-sex');
      else if (b.hasAttribute('data-fx-reg')) state.region = b.getAttribute('data-fx-reg');
      else return;
      render();
    });
    render();
  }

  function go() {
    var boxes = document.querySelectorAll('[data-feeder]');
    if (!boxes.length) return;
    injectCss();
    fetch('/data/feeder-index.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      Array.prototype.forEach.call(boxes, function (box) {
        var k = box.getAttribute('data-feeder');
        try { if (k === "index") drawIndex(box, d); else if (k === "rma") drawRma(box, d); else if (k === "table") drawTable(box, d); } catch (e) { if (window.console) console.warn("feeder box", e); }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
