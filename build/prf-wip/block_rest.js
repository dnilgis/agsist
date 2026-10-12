  /* ---------------------------------------------------------------- the setup controls */
  function useName() { return states[S.st].combos[S.use]; }
  function isGrazing() { return /^graz/i.test(useName()); }
  function buildUse() {
    var c = county(), d = states[S.st], sel = $('prf-use');
    sel.innerHTML = d.combos.map(function (name, i) {
      return c.b[i] == null ? '' : '<option value="' + i + '"' + (i === S.use ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');
  }
  function buildIv() {
    var rows = '';
    for (var i = 0; i < N; i++) {
      rows += '<tr data-i="' + i + '"><th scope="row"><label class="prf-ivl"><input type="checkbox" data-iv-on="' + i + '" aria-label="Insure ' + M.LONG[i] + '"><span class="prf-ivm"><span>' + LABELS[i] + '</span><small data-iv-note="' + i + '"></small></span></label></th>'
        + '<td class="prf-ivp"><button type="button" class="prf-step" data-iv-step="-5" data-i="' + i + '" aria-label="5 percent less in ' + M.LONG[i] + '">−</button>'
        + '<input type="number" inputmode="numeric" min="0" max="100" step="1" data-iv-pct="' + i + '" aria-label="Percent of the policy in ' + M.LONG[i] + '">'
        + '<button type="button" class="prf-step" data-iv-step="5" data-i="' + i + '" aria-label="5 percent more in ' + M.LONG[i] + '">+</button><span class="prf-pc">%</span></td></tr>';
    }
    $('prf-iv-body').innerHTML = rows;
  }
  /* Bring every control into line with the state, without rebuilding the
     inputs (a rebuilt input drops the reader's cursor mid-number). */
  function syncControls() {
    var s = cur(), mm = minmax(), g = openGrid(S.grid);
    $('prf-use').value = String(S.use);
    if (document.activeElement !== $('prf-acres')) $('prf-acres').value = S.acres || '';
    if (document.activeElement !== $('prf-share')) $('prf-share').value = S.share == null ? '' : S.share;
    if (document.activeElement !== $('prf-pf-n')) $('prf-pf-n').value = s.pf;
    $('prf-pf').value = s.pf;
    var cbv = baseValue();
    $('prf-pf-hint').textContent = cbv == null ? '' : 'How much to insure each acre for. 100 is USDA’s county value, ' + usd2(cbv) + ' an acre here for this use. 150 raises the premium and any payment by half. It does not change how often it pays.';
    $('prf-use-note').innerHTML = isGrazing()
      ? 'From 2027, grazing land needs your livestock on it: at least 25% of the stocking rate, or no payment is due and the premium is still owed. <button type="button" class="prf-link" data-jump="new">The rule</button>'
      : 'PRF covers perennial hay ground. Forage planted every year is a different policy, Annual Forage.';
    Array.prototype.forEach.call(document.querySelectorAll('[data-cov]'), function (b) {
      var on = +b.getAttribute('data-cov') === s.cov; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-win]'), function (b) {
      var w = +b.getAttribute('data-win'), on = w === S.win; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = w ? 'Last ' + w : 'All ' + (meta.years.last_complete - meta.years.first + 1);
    });
    var rates = g && g.rates ? g.rates[s.cov] : null;
    for (var i = 0; i < N; i++) {
      var tr = document.querySelector('#prf-iv-body tr[data-i="' + i + '"]'); if (!tr) continue;
      var cb = tr.querySelector('[data-iv-on]'), inp = tr.querySelector('[data-iv-pct]'), note = tr.querySelector('[data-iv-note]');
      var on = s.split[i] > 0, offered = mm.valid[i];
      var nb = (i > 0 && s.split[i - 1] > 0) ? i - 1 : (i < N - 1 && s.split[i + 1] > 0) ? i + 1 : -1;
      var blocked = !on && (nb >= 0 || !offered);
      cb.checked = on; cb.disabled = blocked;
      inp.disabled = !on; if (document.activeElement !== inp) inp.value = on ? s.split[i] : '';
      Array.prototype.forEach.call(tr.querySelectorAll('.prf-step'), function (b) { b.disabled = !on; });
      tr.classList.toggle('is-on', on); tr.classList.toggle('is-off', blocked);
      var t = '', mm_ = g && g.avgMm ? g.avgMm[i] : null;
      if (!offered) t = 'not offered in this county';
      else if (!on && nb >= 0) t = 'off: overlaps ' + LABELS[nb];
      else {
        t = mm.min[i] + '% to ' + mm.max[i] + '% allowed';
        if (mm_ != null) t += ' · normal ' + inTxt(mm_) + (on ? ', pays under ' + inTxt(mm_ * s.cov / 100) : '');
        if (rates && rates[i] == null) t += ' · no rate at this grid';
      }
      note.textContent = t;
    }
    var chk = M.checkSplit(s.split, mm.min, mm.max, mm.valid), tot = $('prf-iv-total');
    tot.textContent = chk.sum === 100 ? '100% placed' : chk.sum < 100 ? chk.sum + '% placed, ' + (100 - chk.sum) + '% to go' : chk.sum + '% placed, ' + (chk.sum - 100) + '% over';
    tot.classList.toggle('is-bad', chk.sum !== 100);
    /* tabs */
    $('prf-tabs').hidden = !S.B;
    $('prf-tab-a').classList.toggle('is-on', S.on === 'A'); $('prf-tab-a').setAttribute('aria-pressed', S.on === 'A' ? 'true' : 'false');
    $('prf-tab-b').classList.toggle('is-on', S.on === 'B'); $('prf-tab-b').setAttribute('aria-pressed', S.on === 'B' ? 'true' : 'false');
    $('prf-addb').hidden = !!S.B;
    $('prf-both').hidden = !S.B;
    $('prf-setup-h').textContent = S.B ? 'Setup ' + S.on : 'Your policy';
    $('prf-iv-h').textContent = S.B ? 'Months to insure, setup ' + S.on : 'Months to insure';
  }
  function rebalance(s) {
    var mm = minmax(), ev = M.evenSplit(s.split.map(function (p) { return p > 0; }), mm.min, mm.max);
    if (ev) s.split = ev;
    return !!ev;
  }
  function toggleIv(i, on) {
    var s = cur(), mm = minmax();
    if (on) {
      if (!mm.valid[i] || (i > 0 && s.split[i - 1] > 0) || (i < N - 1 && s.split[i + 1] > 0)) return;
      s.split[i] = mm.min[i] || 10;
    } else s.split[i] = 0;
    if (s.even) rebalance(s);
    S.touched = true;
    render();
  }
  function setPct(i, v) {
    var s = cur();
    v = Math.max(0, Math.min(100, Math.round(+v) || 0));
    if (s.split[i] === v) return;
    s.split[i] = v; s.even = false; S.touched = true;
    render();
  }

  /* ---------------------------------------------------------------- the answer */
  function yearsPhrase(sum) {
    var all = meta.years.last_complete - meta.years.first + 1;
    return (S.win && S.win < all ? 'last ' + S.win + ' years on record, ' : sum.years + ' years on record, ') + sum.first + ' to ' + sum.last;
  }
  function splitWords(setup) { return setup.split.map(function (p, i) { return p > 0 ? LABELS[i] + ' ' + p + '%' : ''; }).filter(Boolean).join(', ') || 'no months picked'; }
  function policyLine(setup) {
    var c = county();
    return useName() + ' · ' + (S.acres || 0).toLocaleString('en-US') + ' acres · ' + (S.share === 100 ? '' : 'share ' + S.share + '% · ') + setup.cov + '% coverage · '
      + (setup.pf === 100 ? '' : 'productivity factor ' + setup.pf + ' · ') + splitWords(setup) + ' · ' + c.n + ' County, ' + S.st + ' · grid ' + S.grid;
  }
  var SOD = { IA: 1, MN: 1, MT: 1, NE: 1, ND: 1, SD: 1 };
  function drawAnswer(R) {
    var box = $('prf-answer'), line = $('prf-printsum');
    line.innerHTML = (S.touched ? '' : '<b>Example policy.</b> Change it below. ') + esc(policyLine(R.setup)) + '<span class="prf-printonly"> · crop year ' + meta.crop_year + ' · agsist.com/prf</span>';
    if (!R.ok) {
      box.innerHTML = '<p class="prf-verdict prf-wait">' + esc(R.why) + '</p>';
      box.classList.add('is-wait');
      return;
    }
    box.classList.remove('is-wait');
    var s = R.sum, p = R.pol, t = p.total, per = t.producer / S.acres;
    var backFull = t.premium > 0 ? s.avgIndemnity / t.premium : null;
    var verdict;
    if (s.paidYears === 0) verdict = 'In the ' + yearsPhrase(s) + ', this policy would not have paid once.';
    else verdict = 'In the ' + yearsPhrase(s) + ', this policy would have paid something in ' + s.paidYears
      + ' and more than your premium in ' + s.aheadYears + '.';
    if (R.gaps && R.gaps.length) verdict += ' ' + R.gaps.join(', ') + (R.gaps.length > 1 ? ' are' : ' is') + ' left out: USDA publishes no index for a chosen interval in ' + (R.gaps.length > 1 ? 'those years' : 'that year') + '.';
    var best = s.best && s.best.indemnity > 0 ? usd(s.best.indemnity) + ' <span class="prf-sub">in ' + s.best.year + (R.bestTies > 1 ? ' and ' + plural(R.bestTies - 1, 'other year', 'other years') : '') + '</span>' : DASH + ' <span class="prf-sub">it never paid</span>';
    var dry = R.dry ? plural(R.dry.n, 'year', 'years') + ' <span class="prf-sub">' + (R.dry.n > 1 ? R.dry.from + ' to ' + R.dry.to : R.dry.from) + ', the first run that long</span>' : 'none <span class="prf-sub">it paid every year</span>';
    var pctSub = Math.round(R.subsidy * 100);
    var h = '<p class="prf-verdict">' + verdict + '</p>'
      + '<dl class="prf-figs">'
      + '<div><dt>You pay, a year</dt><dd>' + usd(t.producer) + ' <span class="prf-sub">' + usd2(per) + ' an acre, before the policy fee</span></dd></div>'
      + '<div><dt>USDA pays toward the premium</dt><dd>' + usd(t.subsidy) + ' <span class="prf-sub">' + pctSub + '% of the ' + usd(t.premium) + ' premium, if you qualify</span></dd></div>'
      + '<div><dt>Most it can pay in a year</dt><dd>' + usd(t.protection) + ' <span class="prf-sub">' + usd2(p.protectionPerAcre) + ' an acre of protection</span></dd></div>'
      + '<div><dt>Average payout a year</dt><dd>' + usd(s.avgIndemnity) + ' <span class="prf-sub">over all ' + s.years + ' years, the no-payment years included</span></dd></div>'
      + '<div><dt>Payout in the middle year</dt><dd>' + usd(R.mid) + ' <span class="prf-sub">half the years would have paid less than this</span></dd></div>'
      + '<div><dt>Most in one year</dt><dd>' + best + '</dd></div>'
      + '<div><dt>Longest run with no payment</dt><dd>' + dry + '</dd></div>'
      + '</dl>';
    if (backFull != null) {
      var lr = root.getAttribute('data-lr-mid'), lo = root.getAttribute('data-lr-lo'), hi = root.getAttribute('data-lr-hi'), all = meta.years.last_complete - meta.years.first + 1;
      h += '<p class="prf-back">For each $1 of the full premium, this policy would have paid back <b>' + usd2(backFull) + '</b> over those ' + s.years + ' years.'
        + (lr ? ' USDA sets its rates from this same record. Over all ' + all + ' years the middle grid and interval comes to $' + lr + ', and nine in ten sit between $' + lo + ' and $' + hi + ', at every coverage level.' : '')
        + ' So no grid, month or coverage level is a bargain on the record. What comes back above your own ' + usd(t.producer) + ' is the ' + pctSub + '% of the bill USDA pays.</p>';
    }
    h += '<ul class="prf-caveat">'
      + '<li>Every year is priced at ' + meta.crop_year + ' rates and county values, on the precipitation record USDA publishes for ' + meta.crop_year
      + '. It is not what PRF paid in those years, and it says nothing about next year.</li>'
      + '<li>USDA’s share is not automatic. It needs form AD-1026 on file with the Farm Service Agency by the premium billing date. Beginning and veteran farmers get a larger share.</li>'
      + (SOD[S.st] ? '<li>In ' + esc(states[S.st].name) + ', native sod broken in recent years gets less protection and 50 points less of USDA’s share. That rule is not applied here.</li>' : '')
      + '<li>An insurer’s own figure can differ from this by a few dollars of rounding. <button type="button" class="prf-link" data-jump="prf-not">What this insurance does not do</button></li>'
      + '</ul>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- the year chart */
  var chartState = null, READ_HINT = '<span class="prf-read-h">Tap the chart, slide a finger across it, or use the arrows, for one year’s figures.</span>';
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), m = v / p;
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (m <= steps[i]) return steps[i] * p;
    return 10 * p;
  }
  /* RA is always the bars and RB, when there is a second setup that can be
     priced, is always the dots. The colours never swap with the tab. */
  function drawChart(RA, RB) {
    var box = $('prf-chart'), fig = $('prf-chart-fig');
    if (!RA.ok) { fig.hidden = true; chartState = null; return; }
    fig.hidden = false;
    var two = !!S.B, hb = RB && RB.ok && RB.hist.length === RA.hist.length ? RB.hist : null;
    var hist = RA.hist, n = hist.length;
    /* drawn at the width it is shown at, so the axis type is the same size on a phone as on a desk */
    var W = Math.max(280, Math.round(box.clientWidth || 760)), small = W < 520;
    var H = small ? 210 : 250, L = 46, Rr = 6, T = 12, Bm = 24, pw = W - L - Rr, ph = H - T - Bm, every = n <= 30 ? 5 : small ? 20 : 10;
    var mx = 0;
    hist.forEach(function (h) { if (h.indemnity > mx) mx = h.indemnity; });
    if (hb) hb.forEach(function (h) { if (h.indemnity > mx) mx = h.indemnity; });
    mx = niceMax(Math.max(mx, RA.pol.total.producer * 1.15));
    var y = function (v) { return T + ph - (v / mx) * ph; }, bw = pw / n;
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="What the policy would have paid in each year, ' + hist[0].year + ' to ' + hist[n - 1].year + '. The table under “Every year, in numbers” holds every figure.">'];
    [0, 0.5, 1].forEach(function (f) {
      var v = mx * f;
      s.push('<line class="prf-grid" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>');
      s.push('<text class="prf-ax" x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + (v >= 1000 ? '$' + (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k' : '$' + Math.round(v)) + '</text>');
    });
    hist.forEach(function (h, i) {
      var x = L + i * bw, hh = (h.indemnity / mx) * ph;
      if (h.year % every === 0) s.push('<text class="prf-ax" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + h.year + '</text>');
      if (h.indemnity > 0) s.push('<rect class="prf-bar" data-k="' + i + '" x="' + (x + (small ? 0.5 : 1)).toFixed(1) + '" y="' + (T + ph - Math.max(hh, 1.5)).toFixed(1) + '" width="' + Math.max(bw - (small ? 1 : 2), 1).toFixed(1) + '" height="' + Math.max(hh, 1.5).toFixed(1) + '" rx="1.5"/>');
    });
    if (hb) hb.forEach(function (h, i) {
      s.push('<circle class="prf-dot" cx="' + (L + i * bw + bw / 2).toFixed(1) + '" cy="' + y(h.indemnity).toFixed(1) + '" r="2.6"/>');
    });
    var py = y(RA.pol.total.producer);
    s.push('<line class="prf-prem" x1="' + L + '" x2="' + (W - Rr) + '" y1="' + py.toFixed(1) + '" y2="' + py.toFixed(1) + '"/>');
    s.push('<line class="prf-cross" id="prf-cross" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" visibility="hidden"/>');
    s.push('</svg>');
    box.innerHTML = s.join('');
    $('prf-legend').innerHTML = '<span class="prf-lg"><i class="prf-sw prf-sw-bar"></i>' + (two ? 'Setup A, would have paid' : 'Would have paid that year') + '</span>'
      + (hb ? '<span class="prf-lg"><i class="prf-sw prf-sw-dot"></i>Setup B, would have paid</span>' : '')
      + '<span class="prf-lg"><i class="prf-sw prf-sw-line"></i>Your premium' + (two ? ', setup A' : '') + ': ' + usd(RA.pol.total.producer) + ' a year</span>';
    var keep = chartState && chartState.k != null && chartState.k < n && chartState.hist[chartState.k] && chartState.hist[chartState.k].year === hist[chartState.k].year ? chartState.k : null;
    chartState = { hist: hist, hb: hb, L: L, pw: pw, W: W, RA: RA, RB: RB, two: two, k: null, args: [RA, RB] };
    if (keep != null) pickYear(keep); else $('prf-read').innerHTML = READ_HINT;
  }
  function tipFor(k) {
    var c = chartState, h = c.hist[k], b = c.hb ? c.hb[k] : null, g = openGrid(S.grid);
    function lines(hh, tag) {
      return '<span class="prf-read-l">' + (tag ? '<b>' + tag + '</b> ' : '') + 'would have paid <b>' + usd(hh.indemnity) + '</b>, ' + signed(hh.net) + ' after premium'
        + ' <span class="prf-read-s">(' + hh.cells.map(function (cl) {
            var mm_ = g && g.avgMm ? g.avgMm[cl.i] : null;
            return nw(LABELS[cl.i] + ' ' + pctOfNormal(cl.index) + '% of normal') + (mm_ != null && cl.index != null ? ' ' + nw('(' + inTxt(mm_ * cl.index) + ')') : '') + ', ' + usd(cl.paid);
          }).join('; ') + ')</span></span>';
    }
    return '<b class="prf-read-y">' + h.year + '</b> ' + lines(h, c.two ? 'A' : '') + (b ? lines(b, 'B') : '');
  }
  function pickYear(k) {
    var c = chartState, svg = $('prf-chart').querySelector('svg'); if (!c || !svg) return;
    k = Math.max(0, Math.min(c.hist.length - 1, k)); c.k = k;
    var cx = c.L + (k + 0.5) * (c.pw / c.hist.length), cross = $('prf-cross');
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    Array.prototype.forEach.call(svg.querySelectorAll('.prf-bar.is-hot'), function (b) { b.classList.remove('is-hot'); });
    var bar = svg.querySelector('.prf-bar[data-k="' + k + '"]'); if (bar) bar.classList.add('is-hot');
    $('prf-read').innerHTML = tipFor(k);
  }
  function chartMove(ev) {
    var c = chartState, box = $('prf-chart'); if (!c) return;
    var svg = box.querySelector('svg'); if (!svg) return;
    var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * c.W;
    var k = Math.floor((x - c.L) / (c.pw / c.hist.length));
    if (k < 0 || k >= c.hist.length) return;
    pickYear(k);
  }
  /* the year a reader chose stays on screen until another is chosen: a readout that clears itself reads as a glitch */
  var resizeT = null;
  function chartResize() {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      if (!chartState) return;
      var w = Math.round($('prf-chart').clientWidth);
      if (w && Math.abs(w - chartState.W) > 2) drawChart.apply(null, chartState.args);
    }, 150);
  }

  /* ---------------------------------------------------------------- every year, as a table */
  function drawYears(R) {
    var box = $('prf-years');
    if (!$('prf-years-d').open) { box.innerHTML = ''; return; }
    if (!R.ok) { box.innerHTML = '<p class="prf-fine">' + esc(R.why) + '</p>'; return; }
    var used = R.pol.rows.filter(function (r) { return r.pct > 0; });
    /* the totals come first so they stay on a phone's screen; the intervals scroll */
    var h = '<div class="prf-scroll"><table class="prf-t"><caption class="prf-cap">' + (S.B ? 'Setup ' + S.on + ': ' : '') + esc(splitWords(R.setup)) + ', ' + R.setup.cov + '% coverage. What it would have paid, year by year.</caption><thead><tr><th scope="col">Year</th><th scope="col">Would have paid</th><th scope="col">After premium</th>'
      + used.map(function (r) { return '<th scope="col" colspan="2">' + nw(LABELS[r.i]) + ' <span class="prf-th-s">' + R.setup.split[r.i] + '%</span></th>'; }).join('')
      + '</tr><tr class="prf-t-sub"><td></td><td></td><td></td>' + used.map(function () { return '<th scope="col">% of normal</th><th scope="col">paid</th>'; }).join('') + '</tr></thead><tbody>';
    function row(hh, openYear) {
      var whole = hh.complete;
      return '<tr' + (openYear ? ' class="is-open"' : '') + '><th scope="row">' + hh.year + (openYear ? ' <span class="prf-th-s">' + (whole ? 'not in totals' : 'so far') + '</span>' : '') + '</th>'
        + '<td>' + (whole ? usd(hh.indemnity) : DASH) + '</td><td class="' + (whole && hh.net > 0 ? 'is-up' : '') + '">' + (whole ? signed(hh.net) : DASH) + '</td>'
        + hh.cells.map(function (c) { return '<td' + (c.paid > 0 ? ' class="is-pay"' : '') + '>' + pctOfNormal(c.index) + '</td><td>' + (c.paid == null ? DASH : usd(c.paid)) + '</td>'; }).join('') + '</tr>';
    }
    R.open.slice().reverse().forEach(function (hh) { h += row(hh, true); });
    R.hist.slice().reverse().forEach(function (hh) { h += row(hh, false); });
    h += '</tbody></table></div>';
    if (R.open.length) h += '<p class="prf-fine">' + R.open.map(function (o) { return o.year; }).join(', ') + ' is listed and not counted: the figures above stop at ' + meta.years.last_complete
      + ', so every setup is judged on the same years. A dash is an interval USDA has not published yet. These are the ' + meta.crop_year + ' record’s figures and may differ from the index a ' + R.open[0].year + ' policy is paid on.</p>';
    h += '<p class="prf-fine">Percent of normal is precipitation in the grid over those two months, rain and snow together, against its ' + meta.years.first + ' to ' + meta.years.last_complete + ' average. This is the policy’s “index”. Below ' + R.setup.cov + ' it pays.</p>';
    box.innerHTML = h;
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvHead(extra) {
    var c = county();
    return '# AGSIST agsist.com/prf. Grid ' + S.grid + '; ' + c.n + ' County ' + S.st + '; ' + useName().replace(/,/g, '') + '; ' + S.acres + ' acres; share ' + S.share + '%. ' + extra
      + ' Crop year ' + meta.crop_year + ' rates and county values on every year. Not what PRF paid in those years.\n';
  }
  function csv(R) {
    var used = R.pol.rows.filter(function (r) { return r.pct > 0; });
    var out = [['year'].concat(used.reduce(function (a, r) { return a.concat([LABELS[r.i] + ' percent of normal', LABELS[r.i] + ' would have paid']); }, []), ['would have paid', 'you pay (producer premium)', 'after premium', 'counted in totals'])];
    function row(h, counted) {
      out.push([h.year].concat(h.cells.reduce(function (a, c) { return a.concat([c.index == null ? '' : pctOfNormal(c.index), c.paid == null ? '' : c.paid]); }, []),
        [h.indemnity == null ? '' : h.indemnity, R.pol.total.producer, h.net == null ? '' : h.net, counted ? 'yes' : 'no']));
    }
    R.hist.forEach(function (h) { row(h, true); });
    R.open.forEach(function (h) { row(h, false); });
    var head = csvHead((S.B ? 'Setup ' + S.on + '. ' : '') + R.setup.cov + '% coverage; productivity factor ' + R.setup.pf + '; ' + splitWords(R.setup).replace(/,/g, ';') + '.');
    download('prf-grid-' + S.grid + (S.B ? '-setup-' + S.on.toLowerCase() : '') + '.csv', head + out.map(function (r) { return r.join(','); }).join('\n') + '\n');
    track('prf_csv', { grid: S.grid, what: 'policy' });
  }

  /* ---------------------------------------------------------------- the policy, interval by interval */
  function drawPolicy(R) {
    var box = $('prf-pol');
    if (!$('prf-pol-d').open) { box.innerHTML = ''; return; }
    if (!R.ok) { box.innerHTML = '<p class="prf-fine">' + esc(R.why) + '</p>'; return; }
    var c = county(), p = R.pol, t = p.total, pctSub = Math.round(R.subsidy * 100);
    var h = '<div class="prf-scroll"><table class="prf-t"><caption class="prf-cap">' + (S.B ? 'Setup ' + S.on + '. ' : '') + 'The policy as an insurer’s schedule lists it, one line for each interval.</caption><thead><tr><th scope="col">Months</th><th scope="col">% of the policy</th><th scope="col">Protection</th><th scope="col">Premium per $100</th><th scope="col">Premium</th><th scope="col">USDA pays</th><th scope="col">You pay</th></tr></thead><tbody>';
    p.rows.forEach(function (r) {
      if (!(r.pct > 0)) return;
      h += '<tr><th scope="row">' + LABELS[r.i] + '</th><td>' + R.setup.split[r.i] + '%</td><td>' + usd(r.protection) + '</td><td>' + usd2(r.rate * 100) + '</td><td>' + usd(r.premium) + '</td><td>' + usd(r.subsidy) + '</td><td>' + usd(r.producer) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><th scope="row">Whole policy</th><td>100%</td><td>' + usd(t.protection) + '</td><td></td><td>' + usd(t.premium) + '</td><td>' + usd(t.subsidy) + '</td><td>' + usd(t.producer) + '</td></tr></tfoot></table></div>'
      + '<p class="prf-fine">County base value for ' + esc(useName().toLowerCase()) + ' in ' + esc(c.n) + ' County: <b>' + usd2(R.cbv) + '</b> an acre. Protection per acre is that value times ' + R.setup.cov + '% coverage times a productivity factor of ' + R.setup.pf
      + ': <b>' + usd2(p.protectionPerAcre) + '</b>. Protection in an interval is that, times ' + S.acres.toLocaleString('en-US') + ' acres, times your ' + S.share + '% share, times the interval’s part of the policy. USDA’s part of the premium is ' + pctSub + '% at ' + R.setup.cov + '% coverage. Each line is rounded to the dollar, as on USDA’s own calculator.</p>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- each interval on its own */
  function drawRecord() {
    var box = $('prf-rec');
    if (!$('prf-rec-d').open) { box.innerHTML = ''; return; }
    var g = openGrid(S.grid), s = cur(), mm = minmax();
    if (!g || g.stale) { box.innerHTML = ''; return; }
    var pctSub = Math.round(meta.subsidy[String(s.cov)] * 100), done = windowed(g.done), ys = Object.keys(done).map(Number), ny = ys.length;
    var h = '<div class="prf-scroll"><table class="prf-t"><caption class="prf-cap">Every interval at this grid, ' + Math.min.apply(null, ys) + ' to ' + Math.max.apply(null, ys) + ', at ' + s.cov + '% coverage.</caption><thead><tr><th scope="col">Months</th><th scope="col">Normal precipitation</th><th scope="col">Pays under</th><th scope="col">Years it would have paid</th><th scope="col">Driest year, % of normal</th><th scope="col">Middle year, % of normal</th><th scope="col">Premium per $100</th><th scope="col">You pay per $100</th><th scope="col">Would have paid per $100, average year</th></tr></thead><tbody>';
    for (var i = 0; i < N; i++) {
      var r = M.intervalRecord(done, i, s.cov, g.rates[s.cov][i]), mm_ = g.avgMm ? g.avgMm[i] : null;
      if (!mm.valid[i]) { h += '<tr class="is-off"><th scope="row">' + LABELS[i] + '</th><td>' + inTxt(mm_) + '</td><td colspan="7" class="prf-td-l">not offered in this county</td></tr>'; continue; }
      h += '<tr' + (s.split[i] > 0 ? ' class="is-on"' : '') + '><th scope="row">' + LABELS[i] + '</th>'
        + '<td>' + inTxt(mm_) + '</td><td>' + (mm_ == null ? DASH : inTxt(mm_ * s.cov / 100)) + '</td>'
        + '<td>' + (r.years ? r.below + ' of ' + r.years : DASH) + '</td>'
        + '<td>' + (r.lowest ? pctOfNormal(r.lowest.index) + ' <span class="prf-th-s">' + r.lowest.year + '</span>' : DASH) + '</td>'
        + '<td>' + (r.middle == null ? DASH : pctOfNormal(r.middle)) + '</td>'
        + '<td>' + (r.ratePer100 == null ? DASH : usd2(r.ratePer100)) + '</td>'
        + '<td>' + (r.ratePer100 == null ? DASH : usd2(lessPct(r.ratePer100, pctSub))) + '</td>'
        + '<td>' + (r.costPer100 == null ? DASH : usd2(r.costPer100)) + '</td></tr>';
    }
    h += '</tbody></table></div><p class="prf-fine">Per $100 of protection placed in that interval, over the ' + ny + ' years shown. Normal precipitation is USDA’s ' + meta.years.first + ' to ' + meta.years.last_complete
      + ' average for the grid, rain and snow together, and “pays under” is ' + s.cov + '% of it. You pay the premium less USDA’s ' + pctSub + '%. The middle year is the one with half the years drier and half wetter: where it sits well under 100, a few very wet years carry the average and the interval lands below its trigger often. A dash is a rate USDA does not publish for this grid.</p>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- the index, all eleven intervals */
  function indexRows() {
    var g = openGrid(S.grid), rows = [];
    Object.keys(g.done).map(Number).sort(function (a, z) { return a - z; }).forEach(function (y) { rows.push({ year: y, v: g.done[y], open: false }); });
    Object.keys(g.open).map(Number).sort(function (a, z) { return a - z; }).forEach(function (y) { rows.push({ year: y, v: g.open[y], open: true }); });
    return rows;
  }
  function drawIndex() {
    var box = $('prf-idx');
    if (!$('prf-idx-d').open) { box.innerHTML = ''; return; }
    var g = openGrid(S.grid), s = cur();
    if (!g || g.stale) { box.innerHTML = ''; return; }
    var h = '<p class="prf-fine"><button type="button" class="prf-btn" id="prf-idx-csv">Download this table (CSV)</button></p><div class="prf-scroll prf-scroll-tall"><table class="prf-t prf-t-idx"><caption class="prf-cap">Grid ' + S.grid + ': precipitation as a percent of normal, every interval, every year. Shaded cells are under ' + s.cov + ', where a policy at ' + s.cov + '% coverage pays.</caption><thead><tr><th scope="col">Year</th>'
      + LABELS.map(function (l) { return '<th scope="col">' + nw(l) + '</th>'; }).join('') + '</tr></thead><tbody>';
    indexRows().reverse().forEach(function (r) {
      h += '<tr' + (r.open ? ' class="is-open"' : '') + '><th scope="row">' + r.year + '</th>' + r.v.map(function (v) { return '<td' + (v != null && v < s.cov / 100 - 1e-12 ? ' class="is-pay"' : '') + '>' + pctOfNormal(v) + '</td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table></div><p class="prf-fine">USDA’s ' + meta.crop_year + ' record for this grid. A dash is an interval not yet published.</p>';
    box.innerHTML = h;
  }
  function csvIndex() {
    var out = [['year'].concat(LABELS)];
    indexRows().forEach(function (r) { out.push([r.year].concat(r.v.map(function (v) { return v == null ? '' : pctOfNormal(v); }))); });
    download('prf-grid-' + S.grid + '-index.csv', '# AGSIST agsist.com/prf. Grid ' + S.grid + '. Precipitation as a percent of the ' + meta.years.first + ' to ' + meta.years.last_complete + ' average, by two-month interval. USDA RMA, crop year ' + meta.crop_year + ' record.\n'
      + out.map(function (r) { return r.join(','); }).join('\n') + '\n');
    track('prf_csv', { grid: S.grid, what: 'index' });
  }

  /* ---------------------------------------------------------------- the five coverage levels */
  function drawLadder() {
    var box = $('prf-lad');
    if (!$('prf-lad-d').open) { box.innerHTML = ''; return; }
    var s = cur();
    var h = '<div class="prf-scroll"><table class="prf-t"><caption class="prf-cap">The same acres and months at each coverage level' + (S.B ? ', setup ' + S.on : '') + '.</caption><thead><tr><th scope="col">Coverage</th><th scope="col">You pay, a year</th><th scope="col">USDA pays</th><th scope="col">Most it can pay</th><th scope="col">Years it would have paid</th><th scope="col">Average payout</th><th scope="col">Middle year</th></tr></thead><tbody>', why = '';
    M.COVERAGE.forEach(function (cv) {
      var R = compute({ cov: cv, pf: s.pf, split: s.split, even: s.even });
      if (!R.ok) { why = R.why; h += '<tr><th scope="row">' + cv + '%</th><td colspan="6" class="prf-td-l">' + DASH + '</td></tr>'; return; }
      var t = R.pol.total;
      h += '<tr' + (cv === s.cov ? ' class="is-on"' : '') + '><th scope="row">' + cv + '%</th><td>' + usd(t.producer) + '</td><td>' + usd(t.subsidy) + ' <span class="prf-th-s">' + Math.round(R.subsidy * 100) + '%</span></td><td>' + usd(t.protection) + '</td><td>'
        + R.sum.paidYears + ' of ' + R.sum.years + '</td><td>' + usd(R.sum.avgIndemnity) + '</td><td>' + usd(R.mid) + '</td></tr>';
    });
    h += '</tbody></table></div><p class="prf-fine">' + (why ? esc(why) + ' ' : '') + 'A lower coverage level pays less often and costs less, and USDA covers a larger part of a smaller bill. The record does not favor one level: at each, it pays back about the same part of the full premium.</p>';
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- A against B */
  function drawCompare(RA, RB) {
    var box = $('prf-cmp'), wrap = $('prf-cmp-wrap');
    wrap.hidden = !S.B;
    if (!S.B) { box.innerHTML = ''; return; }
    function col(R, f) { return R.ok ? f(R) : DASH; }
    function months(st) { return st.split.map(function (p, i) { return p > 0 ? nw(LABELS[i] + ' ' + p + '%') : ''; }).filter(Boolean).join('<br>') || DASH; }
    var rows = [
      ['Coverage, productivity factor', function (R) { return R.setup.cov + '%, ' + R.setup.pf; }, true],
      ['Months', function (R) { return months(R.setup); }, true],
      ['You pay, a year', function (R) { return usd(R.pol.total.producer); }],
      ['Most it can pay in a year', function (R) { return usd(R.pol.total.protection); }],
      ['Years it would have paid', function (R) { return R.sum.paidYears + ' of ' + R.sum.years; }],
      ['Years it would have paid more than the premium', function (R) { return R.sum.aheadYears + ' of ' + R.sum.years; }],
      ['Average payout a year', function (R) { return usd(R.sum.avgIndemnity); }],
      ['Payout in the middle year', function (R) { return usd(R.mid); }],
      ['Most in one year', function (R) { return R.sum.best && R.sum.best.indemnity > 0 ? usd(R.sum.best.indemnity) + ' (' + R.sum.best.year + ')' : DASH; }],
      ['Longest run with no payment', function (R) { return R.dry ? plural(R.dry.n, 'year', 'years') : 'none'; }]
    ];
    var c = county();
    var h = '<p class="prf-fine">Both setups: ' + esc(useName()) + ', ' + S.acres.toLocaleString('en-US') + ' acres, ' + S.share + '% share, grid ' + S.grid + ', ' + esc(c.n) + ' County.</p>'
      + '<div class="prf-scroll"><table class="prf-t prf-t-cmp"><thead><tr><td></td><th scope="col">Setup A</th><th scope="col">Setup B</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var a = r[2] ? r[1]({ setup: S.A }) : col(RA, r[1]), b = r[2] ? r[1]({ setup: S.B }) : col(RB, r[1]);
      h += '<tr><th scope="row">' + r[0] + '</th><td>' + a + '</td><td>' + b + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (!RA.ok) h += '<p class="prf-fine">Setup A: ' + esc(RA.why) + '</p>';
    if (!RB.ok) h += '<p class="prf-fine">Setup B: ' + esc(RB.why) + '</p>';
    if (RA.ok && RB.ok) {
      if (RA.hist.length !== RB.hist.length) {
        h += '<p class="prf-fine">The two setups are not counted over the same years here: USDA publishes no index for some interval in one of them. Compare the year table, not the totals.</p>';
      } else {
        var d = RA.hist.map(function (ha, i) { return { year: ha.year, a: ha.indemnity, b: RB.hist[i].indemnity }; });
        var onlyA = d.filter(function (x) { return x.a > 0 && x.b === 0; }).length, onlyB = d.filter(function (x) { return x.b > 0 && x.a === 0; }).length, both = d.filter(function (x) { return x.a > 0 && x.b > 0; }).length;
        h += '<p class="prf-fine">Both setups are run over the same ' + RA.sum.years + ' years, ' + RA.sum.first + ' to ' + RA.sum.last + '. Both would have paid in ' + plural(both, 'year', 'years') + ', only A in ' + onlyA + ', only B in ' + onlyB + ', neither in ' + (d.length - both - onlyA - onlyB)
          + '. The table says what each would have done. It does not say which to buy: the months to insure are the ones when a dry spell costs you grass or hay.</p>';
      }
    }
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------------- the grids next door */
  function drawNeighbors() {
    var box = $('prf-nb');
    if (!$('prf-nb-d').open) { box.innerHTML = ''; return; }
    var c = county(), rc = M.gridRowCol(S.grid), s = cur(), ids = [], want = {};
    for (var dr = 1; dr >= -1; dr--) for (var dc = -1; dc <= 1; dc++) {
      var r = rc.row + dr, cc = rc.col + dc;
      if (r < 0 || cc < 0 || r >= 120 || cc >= 300) { ids.push(null); continue; }
      var id = r * 300 + cc + 1; ids.push(id);
      if (c.g.indexOf(id) >= 0) want[M.shardKey(id)] = 1;
    }
    var grid = S.grid, co = S.co, tag = setupStr(s) + S.use + S.acres + S.share + S.win;
    box.innerHTML = '<p class="prf-fine">Reading the grids next door…</p>';
    Promise.all(Object.keys(want).map(loadShard)).then(function () {
      if (grid !== S.grid || co !== S.co || tag !== setupStr(cur()) + S.use + S.acres + S.share + S.win || !$('prf-nb-d').open) return;
      var h = '<div class="prf-nb-g">', shown = 0;
      ids.forEach(function (id) {
        if (id == null) { h += '<div class="prf-nb-c is-out"></div>'; return; }
        if (c.g.indexOf(id) < 0) { h += '<div class="prf-nb-c is-out"><span class="prf-nb-id">' + id + '</span><span class="prf-nb-x">not in ' + esc(c.n) + ' County</span></div>'; return; }
        var keepG = S.grid; S.grid = id;
        var R = compute(s); S.grid = keepG;
        shown++;
        h += '<' + (id === grid ? 'div' : 'button type="button" data-grid="' + id + '" data-county="' + stateFips() + S.co + '"') + ' class="prf-nb-c' + (id === grid ? ' is-here' : '') + '">'
          + '<span class="prf-nb-id">' + id + (id === grid ? ' · shown above' : '') + '</span>'
          + (R.ok ? '<span class="prf-nb-v">' + usd(R.pol.total.producer) + '</span><span class="prf-nb-x">you pay · would have paid in ' + R.sum.paidYears + ' of ' + R.sum.years + ' · average ' + usd(R.sum.avgIndemnity) + '</span>'
                  : '<span class="prf-nb-x">' + esc(R.why) + '</span>')
          + '</' + (id === grid ? 'div' : 'button') + '>';
      });
      h += '</div><p class="prf-fine">The same policy on each grid’s own record and rates, with ' + esc(c.n) + ' County values. North is up. A grid that paid more also costs more: USDA sets each grid’s rate from its own record. Which grid a policy uses follows from where the land is. You pick a point inside the acres you insure, and land that lies across a grid line can go in either grid or be split between them (Rainfall Index Basic Provisions, section 6(f)).</p>';
      box.innerHTML = shown > 1 ? h : '<p class="prf-fine">Grid ' + grid + ' has no neighbor in ' + esc(c.n) + ' County with PRF offers.</p>';
    }).catch(function () { box.innerHTML = '<p class="prf-fine">The neighboring grids did not load. Try again.</p>'; });
  }

  /* ---------------------------------------------------------------- the pinned line */
  var answerSeen = true, lookNow = function () {};
  function drawBar(R) {
    var bar = $('prf-bar');
    if (R) {
      bar.setAttribute('data-ok', R.ok ? '1' : '0');
      bar.innerHTML = R.ok
        ? (S.touched ? '' : 'Example: ') + S.acres.toLocaleString('en-US') + ' ac · you pay <b>' + usd(R.pol.total.producer) + '</b> · paid <b>' + R.sum.paidYears + ' of ' + R.sum.years + '</b> yrs · avg <b>' + usd(R.sum.avgIndemnity) + '</b>'
        : esc(R.why);
    }
    var nav = document.querySelector('.nav');
    bar.style.top = Math.max(0, nav ? nav.getBoundingClientRect().bottom : 0) + 'px';
    bar.hidden = answerSeen || !S.grid || $('prf-tool').hidden;
  }
  /* Measured on scroll rather than observed: the answer card is "seen" while
     any of it is between the site header and the bottom of the screen. */
  function watchAnswer() {
    var queued = false;
    function look() {
      queued = false;
      var nav = document.querySelector('.nav'), top = nav ? nav.getBoundingClientRect().bottom : 0;
      var r = $('prf-answer').getBoundingClientRect();
      var seen = r.bottom > top + 8 && r.top < window.innerHeight;
      if (seen !== answerSeen || !seen) { answerSeen = seen; drawBar(null); }
    }
    function ask() { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(look); } }
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
    lookNow = ask;
  }

  /* ---------------------------------------------------------------- draw everything */
  var lastR = null;
  function render() {
    if (!S.grid || !county()) return;
    syncControls();
    var RA = compute(S.A), RB = S.B ? compute(S.B) : null, onB = S.on === 'B' && !!RB, R = onB ? RB : RA;
    lastR = R;
    drawAnswer(R);
    drawChart(RA, RB);
    drawYears(R); drawPolicy(R); drawRecord(); drawIndex(); drawLadder(); drawCompare(RA, RB); drawNeighbors();
    $('prf-acts').hidden = !R.ok;
    drawBar(R);
    $('prf-answer-h').textContent = 'What it costs and what it would have paid' + (S.B ? ', setup ' + S.on : '');
    remember();
    lookNow();
  }

  /* ---------------------------------------------------------------- wiring */
  function wire() {
    $('prf-find').addEventListener('submit', function (e) { e.preventDefault(); $('prf-q').blur(); find($('prf-q').value); });
    $('prf-loc').addEventListener('click', function () {
      if (!navigator.geolocation) { say('This browser will not share a location. Type a ZIP.', true); return; }
      var my = ++ticket;
      say('Asking the browser for your location…');
      track('prf_find', { by: 'location' });
      navigator.geolocation.getCurrentPosition(function (p) { if (my === ticket) atPoint(p.coords.latitude, p.coords.longitude, 'your location', {}); },
        function () { if (my === ticket) say('The browser did not share a location. Type a ZIP, or pick by state and county.', true); }, { timeout: 12000, maximumAge: 600000 });
    });
    $('prf-eg').addEventListener('click', function () { S.touched = false; goGrid(30454, { county: '55005' }); track('prf_find', { by: 'example' }); });
    $('prf-b-st').addEventListener('change', fillBrowseCounties);
    $('prf-b-co').addEventListener('change', fillBrowseGrids);
    root.addEventListener('click', function (e) {
      var cl = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
      var t = cl('[data-asgrid]');
      if (t) { goGrid(+t.getAttribute('data-asgrid'), {}).then(function (ok) { if (ok) toGrid(); }); return; }
      t = cl('[data-choice]');
      if (t && choiceGo) { var r = choices[+t.getAttribute('data-choice')]; if (r) choiceGo(r); return; }
      t = cl('[data-grid]');
      if (t && !t.closest('#prf-map')) { goGrid(+t.getAttribute('data-grid'), { county: t.getAttribute('data-county') }, true).then(function (ok) { if (ok && t.closest('#prf-b-grids')) toGrid(); }); return; }
      t = cl('[data-jump]');
      if (t) { var d = $(t.getAttribute('data-jump')); if (d) { d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
      t = cl('[data-win]');
      if (t) { S.win = +t.getAttribute('data-win'); render(); track('prf_window', { years: S.win || 'all' }); return; }
      t = cl('[data-yr]');
      if (t && chartState) { pickYear(chartState.k == null ? (+t.getAttribute('data-yr') > 0 ? 0 : chartState.hist.length - 1) : chartState.k + +t.getAttribute('data-yr')); return; }
      if (cl('#prf-idx-csv')) { csvIndex(); return; }
      t = cl('a[data-out]');
      if (t) track('prf_out', { to: t.getAttribute('data-out') });
    });
    function mapPick(e) {
      var t = e.target.closest ? e.target.closest('[data-grid]') : null;
      if (!t) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      goGrid(+t.getAttribute('data-grid'), { county: S.co ? stateFips() + S.co : null }, true);
    }
    $('prf-map').addEventListener('click', mapPick);
    $('prf-map').addEventListener('keydown', mapPick);
    $('prf-co').addEventListener('change', function () {
      var v = this.value; if (!v) return;
      S.st = stateByFips(v.slice(0, 2)).st; S.co = v.slice(2); S.coHow = 'named'; afterGrid();
    });
    function touch() { S.touched = true; }
    $('prf-use').addEventListener('change', function () { S.use = +this.value; touch(); ['A', 'B'].forEach(function (k) { if (S[k]) fit(S[k]); }); render(); });
    /* a number box that is tapped is about to be replaced, not added to: 100 then "3000" must not read 1003000 */
    ['prf-acres', 'prf-share', 'prf-pf-n'].forEach(function (id) { $(id).addEventListener('focus', function () { var el = this; setTimeout(function () { try { el.select(); } catch (e) {} }, 0); }); });
    $('prf-acres').addEventListener('input', function () { var v = Math.round(+this.value); S.acres = v > 0 && v <= 5000000 ? v : 0; touch(); render(); });
    $('prf-acres').addEventListener('blur', function () { this.value = S.acres || ''; });
    $('prf-share').addEventListener('input', function () { var v = +this.value; S.share = this.value !== '' && v >= 1 && v <= 100 ? Math.round(v) : null; touch(); render(); });
    $('prf-share').addEventListener('blur', function () { if (S.share != null) this.value = S.share; });
    $('prf-pf').addEventListener('input', function () { cur().pf = +this.value; touch(); render(); });
    $('prf-pf-n').addEventListener('input', function () { var v = +this.value; cur().pf = this.value !== '' && v >= 60 && v <= 150 ? Math.round(v) : NaN; touch(); render(); });
    $('prf-pf-n').addEventListener('blur', function () { if (!(cur().pf >= 60)) { cur().pf = 100; render(); } this.value = cur().pf; });
    $('prf-cov').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-cov]') : null; if (b) { cur().cov = +b.getAttribute('data-cov'); touch(); render(); } });
    var body = $('prf-iv-body');
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-iv-on')) toggleIv(+t.getAttribute('data-iv-on'), t.checked);
    });
    body.addEventListener('focusin', function (e) { var t = e.target; if (t.hasAttribute && t.hasAttribute('data-iv-pct')) setTimeout(function () { try { t.select(); } catch (er) {} }, 0); });
    /* A percent being typed: an empty box or a zero is a number half typed,
       not "turn this month off". The month goes off when the box is left that way. */
    body.addEventListener('input', function (e) {
      var t = e.target; if (!t.hasAttribute('data-iv-pct')) return;
      var v = Math.round(+t.value);
      if (t.value === '' || !(v > 0)) return;
      setPct(+t.getAttribute('data-iv-pct'), v);
    });
    body.addEventListener('focusout', function (e) {
      var t = e.target; if (!t.hasAttribute || !t.hasAttribute('data-iv-pct')) return;
      var i = +t.getAttribute('data-iv-pct'), v = Math.round(+t.value);
      if (t.value === '' || !(v > 0)) { if (cur().split[i] > 0) { cur().split[i] = 0; if (cur().even) rebalance(cur()); render(); } return; }
      t.value = cur().split[i] || '';
    });
    body.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-iv-step]') : null; if (!b) return;
      var i = +b.getAttribute('data-i'), s = cur(), mm = minmax(), v = s.split[i] + +b.getAttribute('data-iv-step');
      v = Math.max(mm.min[i] || 10, Math.min(mm.max[i] || 100, v));
      var inp = body.querySelector('[data-iv-pct="' + i + '"]'); if (inp) inp.value = v;
      setPct(i, v);
    });
    $('prf-even').addEventListener('click', function () {
      var s = cur(), tot = $('prf-iv-total'); s.even = true; S.touched = true;
      var ok = rebalance(s); render();
      if (!ok) { tot.textContent = 'These months cannot be split to 100% within this county’s limits. Add or drop a pair.'; tot.classList.add('is-bad'); }
    });
    var undo = null;
    $('prf-clear').addEventListener('click', function () {
      var s = cur(), b = this;
      if (undo) { s.split = undo; undo = null; b.textContent = 'Clear'; render(); return; }
      undo = s.split.slice(); s.split = blank(); s.even = true; S.touched = true; render();
      b.textContent = 'Undo clear'; setTimeout(function () { undo = null; b.textContent = 'Clear'; }, 8000);
    });
    $('prf-addb').addEventListener('click', function () { S.B = { cov: S.A.cov, pf: S.A.pf, split: S.A.split.slice(), even: S.A.even }; S.on = 'B'; S.touched = true; render(); track('prf_compare', {}); $('prf-tabs').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('prf-tab-a').addEventListener('click', function () { S.on = 'A'; render(); });
    $('prf-tab-b').addEventListener('click', function () { S.on = 'B'; render(); });
    $('prf-dropb').addEventListener('click', function () { S.B = null; S.on = 'A'; render(); });
    ['prf-years-d', 'prf-pol-d', 'prf-rec-d', 'prf-idx-d', 'prf-lad-d', 'prf-nb-d'].forEach(function (id) {
      $(id).addEventListener('toggle', function () { if (this.open) track('prf_open', { what: id.replace(/^prf-|-d$/g, '') }); render(); });
    });
    watchAnswer();
    var ch = $('prf-chart');
    ch.addEventListener('pointermove', chartMove); ch.addEventListener('pointerdown', chartMove);
    window.addEventListener('resize', chartResize);
    $('prf-csv').addEventListener('click', function () { if (lastR && lastR.ok) csv(lastR); });
    $('prf-print').addEventListener('click', function () { $('prf-years-d').open = true; $('prf-pol-d').open = true; render(); track('prf_print', { grid: S.grid }); window.print(); });
    $('prf-share-b').addEventListener('click', function () {
      var u = shareUrl(), b = this, done = function () { b.textContent = 'Link copied'; setTimeout(function () { b.textContent = 'Copy a link to this'; }, 2200); };
      track('prf_share', { grid: S.grid });
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, function () { window.prompt('Copy this link', u); });
      else window.prompt('Copy this link', u);
    });
  }

  function start() {
    var st = $('prf-status'), o = saved();
    st.textContent = 'Loading the rain record…';
    /* a link or a return visit is about to draw the whole tool: hold the room for it so the page below does not jump */
    if (o && o.g) $('prf-app').style.minHeight = '100vh';
    getJSON(SRC + 'meta.json').then(function (m) {
      meta = m;
      if (!meta || !meta.states || !meta.years || !meta.subsidy) throw new Error('meta');
      $('prf-b-st').innerHTML = '<option value="">Pick a state</option>' + meta.states.map(function (s) { return '<option value="' + s.st + '">' + esc(s.name) + '</option>'; }).join('');
      wire();
      st.hidden = true; st.textContent = '';
      $('prf-app').hidden = false;
      if (o && o.g) {
        var bad = [], a = parseSetup(o.a), b = o.b ? parseSetup(o.b) : null, nyears = meta.years.last_complete - meta.years.first + 1;
        if (a) S.A = a; else if (o.fromLink && o.a != null) bad.push('the months and coverage');
        if (b) S.B = b; else if (o.fromLink && o.b) bad.push('the second setup');
        if (o.u != null) { if (/^\d$/.test(String(o.u)) && +o.u < 7) S.use = +o.u; else if (o.fromLink) bad.push('the use of the land'); }
        if (o.ac != null) { if (+o.ac >= 1 && +o.ac <= 5000000) S.acres = Math.round(+o.ac); else if (o.fromLink) bad.push('the acres'); }
        if (o.sh != null) { if (+o.sh >= 1 && +o.sh <= 100) S.share = Math.round(+o.sh); else if (o.fromLink) bad.push('the share'); }
        if (o.w != null && o.w !== '' && +o.w !== 0) { if (WINDOWS.indexOf(+o.w) > 0 && +o.w < nyears) S.win = +o.w; else if (o.fromLink) bad.push('the years counted'); }
        S.touched = o.fromLink ? true : !!o.t;
        var pt = o.pt && isFinite(o.pt.lat) && isFinite(o.pt.lon) ? o.pt : null;
        goGrid(/^\d{1,5}$/.test(String(o.g)) ? +o.g : NaN, { county: o.c, pt: pt }).then(function (ok) {
          $('prf-app').style.minHeight = '';
          if (ok && bad.length) say('This link’s figures for ' + bad.join(', ') + ' could not be read, so the page’s own are shown for ' + (bad.length > 1 ? 'those' : 'that') + '.', true);
          if (ok && o.fromLink) { toGrid(); lookNow(); }
        });
      } else if (o && (o.c || o.st)) {
        /* a link to a county or a state: open the picker there */
        var code = /^\d{5}$/.test(String(o.c || '')) ? String(o.c) : null, s0 = code ? stateByFips(code.slice(0, 2)) : null;
        if (!s0 && o.st) meta.states.forEach(function (s) { if (s.st === String(o.st).toUpperCase()) s0 = s; });
        if (s0) {
          document.querySelector('.prf-browse').open = true;
          $('prf-b-st').value = s0.st;
          fillBrowseCounties().then(function () { if (code && states[s0.st] && states[s0.st].counties[code.slice(2)]) { $('prf-b-co').value = code.slice(2); fillBrowseGrids(); } });
        }
      }
    }).catch(function () {
      $('prf-app').style.minHeight = '';
      st.hidden = false;
      st.textContent = 'The rain record did not load, so the calculator is off. Reload the page, or try again in a few minutes. The rules and dates below do not need it.';
      st.classList.add('is-bad');
    });
  }
  window.AgPrf = { state: S, compute: compute, find: find, goGrid: goGrid, shareUrl: shareUrl, countyAtPoint: countyAtPoint };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
