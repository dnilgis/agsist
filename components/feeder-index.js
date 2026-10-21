/* AGSIST feeder cattle boxes, drawn from /data/feeder-index.json
   (scripts/build_feeder_index.py computes every number; this file only draws).
   Mount points:
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
    if (!d || typeof d !== 'object') return { down: true, msg: 'RMA&rsquo;s feeder value did not load. It is on RMA&rsquo;s own files at pubfs-rma.fpac.usda.gov.' };
    var r = d.rma;
    if (!r || !r.ok || !fxNum(r.value) || r.value <= 0 || !isFinite(fxDay(r.date))) return { down: true, msg: 'RMA&rsquo;s feeder value could not be read on the last run. Nothing is filled in.' };
    var age = (nowMs - fxDay(r.date)) / 864e5;
    var old = age > RMA_OLD_DAYS;
    var out = {
      down: false, old: old,
      val: old ? '-' : fxMoney(r.value),
      date: fxLab(r.date),
      meta: old ? ('Latest held: ' + fxLab(r.date) + '. RMA has not posted a newer value, so it is not shown.')
                : (fxLab(r.date) + ' &middot; as published by USDA RMA'),
      label: r.label || '',
      basis: r.basis_note || '',
      fut: null, diff: null, futNote: ''
    };
    if (!old && r.fut && fxNum(r.fut.settle) && fxNum(r.diff)) {
      out.fut = (r.fut.ticker || 'Nearby') + ' settle ' + fxLab(r.fut.date, true) + ': ' + fxMoney(r.fut.settle);
      out.diff = fxSigned(r.diff);
      out.diffWord = r.diff > 0 ? 'over' : r.diff < 0 ? 'under' : 'even with';
    } else if (!old) {
      out.futNote = 'No feeder futures settle held for ' + fxLab(r.date) + ', so no difference is shown. We keep each day&rsquo;s settle from Oct 15, 2026 on.';
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

  // The 700-899 lb national steer line and its RMA comparison.
  function sliceView(d) {
    if (!d || !d.auction || !d.auction.table) return null;
    var o = ((d.auction.table.steers || {}).us || {})['700-899'];
    if (!o || !fxNum(o.p)) return null;
    var s = { p: fxMoney(o.p), n: fxInt(o.barns) + ' barns, ' + fxInt(o.head) + ' head', week: fxWeek(d.auction.week) };
    var c = d.check;
    if (c && fxNum(c.gap) && fxNum(c.rma)) {
      s.check = 'RMA&rsquo;s steer value averaged ' + fxMoney(c.rma) + ' over the ' + c.rma_days + ' days it posted that week, so these barns ran ' + fxSigned(c.gap) + ' against it.';
    } else if (c && fxNum(c.rma)) {
      s.check = 'Compared with RMA&rsquo;s steer value once RMA has posted 3 days of that week (it has posted ' + c.rma_days + ').';
    }
    return s;
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

  var CSS = '.fx{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:1rem 1.1rem;margin:0 0 1rem}' +
    '.fx h2,.fx h3{margin:0 0 .25rem;font-size:1.08rem;color:var(--text)}' +
    '.fx .fx-sub{margin:0 0 .5rem;font-size:.86rem;color:var(--text-muted,var(--text-dim))}' +
    '.fx .fx-val{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:2rem;line-height:1.1;color:var(--text)}' +
    '.fx .fx-val small{font-size:.8rem;font-weight:400;color:var(--text-muted,var(--text-dim))}' +
    '.fx .fx-row{display:flex;flex-wrap:wrap;gap:.3rem 1.2rem;margin:.4rem 0;font-size:.9rem}' +
    '.fx .fx-row b{font-family:"JetBrains Mono",monospace}' +
    '.fx .fx-note{font-size:.84rem;color:var(--text-muted,var(--text-dim));margin:.35rem 0;line-height:1.5}' +
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
    '.fx details{margin:.5rem 0 0;font-size:.86rem}.fx summary{cursor:pointer;font-weight:600;color:var(--text)}' +
    '.fx details ul{padding-left:1.1rem;margin:.4rem 0}.fx details li{margin:.2rem 0;color:var(--text-dim)}' +
    '.fx .fx-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--border);border-radius:10px;overflow:hidden;max-width:100%;margin:0 .5rem .5rem 0}' +
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
    '' +
    '@media(max-width:480px){.fx{padding:.8rem .7rem}.fx .fx-t{font-size:.82rem}.fx .fx-t th,.fx .fx-t td{padding:.35rem .25rem}.fx .fx-val{font-size:1.7rem}}';

  function injectCss() {
    if (document.getElementById('fx-css')) return;
    var s = document.createElement('style'); s.id = 'fx-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  var RMA_CREDIT = 'Source: <a href="https://pubfs-rma.fpac.usda.gov/pub/References/adm_livestock/" rel="noopener">USDA RMA</a>, Livestock Risk Protection actual ending values, read from RMA&rsquo;s daily ADM livestock files. Futures settles: CME feeder cattle futures via Yahoo Finance, the settle after the close. ' +
    '<a href="https://www.rma.usda.gov/sites/default/files/2026-06/2027-20010-Livestock-Risk-Protection.pdf" rel="noopener">RMA LRP Handbook FCIC-20010</a>, section 23C.';
  var AMS_CREDIT = 'Source: <a href="https://mymarketnews.ams.usda.gov/" rel="noopener">USDA AMS</a> auction reports (Livestock, Poultry and Grain Market News), as read for this page. Prices are AGSIST&rsquo;s sums of USDA&rsquo;s rows.';

  function drawRma(box, d) {
    var v = rmaView(d, Date.now());
    var compact = box.getAttribute('data-compact') === '1';
    var h = '<h2>Feeder steers, RMA&rsquo;s daily value</h2>';
    if (!v || v.down) {
      box.innerHTML = h + '<p class="fx-down">' + (v ? v.msg : '') + '</p><p class="fx-src">' + RMA_CREDIT + '</p>';
      box.hidden = false; return;
    }
    h += '<p class="fx-sub">' + esc(v.label) + '</p>' +
      '<div class="fx-val">' + v.val + (v.old ? '' : ' <small>$/cwt</small>') + '</div>' +
      '<p class="fx-note">' + v.meta + '</p>';
    if (v.fut) h += '<div class="fx-row"><span>Nearby futures, ' + esc(v.fut) + '</span><span>RMA value minus futures: <b>' + esc(v.diff) + '</b></span></div>';
    else if (v.futNote) h += '<p class="fx-note">' + v.futNote + '</p>';
    box.hidden = false;
    var cs = window.getComputedStyle ? getComputedStyle(box) : null;
    var cw = box.clientWidth ? box.clientWidth - (cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 36) : 640;
    if (!compact && !v.old) {
      h += chartSvg(v.hist, cw);
      if (v.range) h += '<p class="fx-note">' + v.range + '</p>';
    }
    h += '<details><summary>What this number is</summary><ul>' +
      '<li>' + v.basis + '</li>' +
      '<li>The handbook says RMA applies each type&rsquo;s price adjustment factor before it publishes. This is the type with a factor of 1.00: steers, 6 to 10 cwt. Heifers and lighter steers are this value times their factor.</li>' +
      '<li>Dated by the end date RMA gives it. RMA posts it a few business days later, so the newest value lags the board.</li>' +
      '<li>The difference is RMA&rsquo;s value minus the nearby feeder futures settle on the same date, only on days we hold that settle.</li>' +
      '</ul></details>';
    h += '<p class="fx-src">' + RMA_CREDIT + '</p>';
    box.innerHTML = h; box.hidden = false;
    if (!compact && !v.old) wireChart(box, v.hist, cw);
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
      var s = sliceView(d);
      if (s) h += '<p class="fx-note"><b>700 to 899 lb steers, all barns:</b> ' + s.p + ' (' + esc(s.n) + ').' + (s.check ? ' ' + s.check : '') + '</p>';
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
        try { if (k === "rma") drawRma(box, d); else if (k === "table") drawTable(box, d); } catch (e) { if (window.console) console.warn("feeder box", e); }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
