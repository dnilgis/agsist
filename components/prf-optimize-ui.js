/* components/prf-optimize-ui.js: the "What the numbers would pick" panel on
   /prf (window.AgPrfOptUI). Mounts into <section id="prf-optimize">.

   WHAT COMPUTES WHAT
     components/prf-optimize.js owns every figure: the pick, its record, the
     forecast tilt and the walk-forward test for this grid. data/prf/opt.json
     (scripts/prf_opt_backtest.mjs) holds the same test run across a fixed
     sample of grids in every state. This file only converts per-$100 figures
     to the reader's dollars and prints.

   HOW IT IS FED
     components/prf.js calls AgPrfOptUI.update(ctx) after each render, with the
     grid's complete years, rates, the county's limits and the reader's
     policy. Nothing here reads prf.js's state directly. "Use this setup in
     the calculator above" calls ctx.apply(split); without one it fires a
     'prf:use-split' event on window with { split }.

   WHAT IT WILL NOT PRINT
     * a pick without the out-of-sample record beside it, in words first;
     * a forecast tilt as if it were tested (no archive of past outlooks);
     * anything when fewer than 30 complete years are on record.

   Plain words, no em dashes. */
(function (root) {
  'use strict';
  var O = root.AgPrfOptimize;
  if (!O) return;
  var LABELS = O.LABELS, N = O.N;
  var state = { objective: 'net', enso: null, ensoFromFile: null, opt: null, outlook: null, loaded: false, loading: null, ctx: null, cache: {} };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function usd(v) { if (v == null || !isFinite(v)) return 'not available'; var n = Math.round(v); return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US'); }
  function signed(v) { if (v == null || !isFinite(v)) return 'not available'; var n = Math.round(v); return (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US'); }
  function per100(v) { return v == null ? 'not available' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2); }
  function pctTxt(v) { return v == null ? 'not available' : (Math.round(v * 10) / 10) + '%'; }
  function pOdds(p) { return p < 0.001 ? 'under 1 in 1,000' : p < 0.01 ? 'under 1 in 100' : 'about 1 in ' + Math.max(1, Math.round(1 / p)); }
  function splitWords(sp) { var a = []; for (var i = 0; i < N; i++) if (sp[i]) a.push(LABELS[i] + ' ' + sp[i] + '%'); return a.join(', '); }

  function css() {
    if (document.getElementById('prf-opt-css')) return;
    var st = document.createElement('style');
    st.id = 'prf-opt-css';
    st.textContent = [
      '#prf-optimize .po-note{color:var(--text-muted);font-size:var(--fs-sm);margin:.2rem 0 .8rem;max-width:46em}',
      '#prf-optimize .po-verdict{font-size:1.08rem;font-weight:700;line-height:1.45;margin:.6rem 0;max-width:40em;color:var(--text)}',
      '#prf-optimize .po-tabs{display:flex;flex-wrap:wrap;gap:.4rem;margin:.6rem 0}',
      '#prf-optimize .po-tab{min-height:44px;padding:0 .8rem;border:1px solid var(--border-2);border-radius:8px;background:transparent;color:var(--text);font:inherit;cursor:pointer}',
      '#prf-optimize .po-tab.is-on{border-color:var(--gold);color:var(--gold);font-weight:600}',
      '#prf-optimize .po-split{display:grid;grid-template-columns:repeat(auto-fill,minmax(7.2rem,1fr));gap:.4rem;margin:.6rem 0}',
      '#prf-optimize .po-iv{border:1px solid var(--border-2);border-radius:8px;padding:.45rem .55rem}',
      '#prf-optimize .po-iv b{display:block;font-size:1.15rem;color:var(--gold)}',
      '#prf-optimize .po-iv span{font-size:var(--fs-sm);color:var(--text-muted)}',
      '#prf-optimize .po-use{min-height:44px;padding:0 1rem;border-radius:8px;border:2px solid var(--gold);background:transparent;color:var(--gold);font:inherit;font-weight:600;cursor:pointer;margin:.3rem 0 .8rem}',
      '#prf-optimize table{border-collapse:collapse;width:100%;font-size:var(--fs-sm);margin:.4rem 0}',
      '#prf-optimize th,#prf-optimize td{text-align:right;padding:.35rem .4rem;border-bottom:1px solid var(--border-2);vertical-align:top}',
      '#prf-optimize th:first-child,#prf-optimize td:first-child{text-align:left}',
      '#prf-optimize .po-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}',
      '#prf-optimize ul.po-why{margin:.4rem 0;padding-left:1.1rem;max-width:46em;line-height:1.5}',
      '#prf-optimize ul.po-why li{margin:.25rem 0}',
      '#prf-optimize h3{font-size:1rem;margin:1rem 0 .3rem}',
      '#prf-optimize .po-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;font-size:var(--fs-sm)}',
      '#prf-optimize select{min-height:44px;font:inherit;color:var(--text);background:var(--surface,transparent);border:1px solid var(--border-2);border-radius:8px;padding:0 .5rem}',
      '#prf-optimize details{border-top:1px solid var(--border-2);margin-top:.8rem}',
      '#prf-optimize details>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}',
      '@media (max-width:640px){#prf-optimize table,#prf-optimize tbody,#prf-optimize tr,#prf-optimize td{display:block;width:auto}#prf-optimize thead{position:absolute;left:-9999px}#prf-optimize tr{border-bottom:1px solid var(--border-2);padding:.4rem 0}#prf-optimize td{border:0;text-align:left;padding:.15rem 0}#prf-optimize td[data-l]::before{content:attr(data-l) ": ";color:var(--text-muted)}}',
      '#prf-optimize .po-fine{color:var(--text-muted);font-size:var(--fs-sm);line-height:1.55;max-width:46em}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* opt.json and outlook.json, once; both optional, the panel says what is
     missing. data/prf/climate-indices.json only when a predictor that held up
     in opt.json needs a NOAA series (PDO, AMO); otherwise it is not fetched. */
  function load(src) {
    if (state.loading) return state.loading;
    function get(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    state.loading = Promise.all([get(src + 'opt.json'), get(src + 'outlook.json')]).then(function (r) {
      state.opt = r[0]; state.outlookJson = r[1];
      state.kept = O.keptPredictors(state.opt);
      var needs = state.kept.some(function (id) { var p = O.predictorById(id); return p && p.needs && p.needs.length; });
      return needs ? get(src + 'climate-indices.json').then(function (c) { state.climate = c; }) : null;
    }).then(function () { state.loaded = true; });
    return state.loading;
  }

  function section() { return document.getElementById('prf-optimize'); }
  function body() {
    var sec = section(); if (!sec) return null;
    var b = sec.querySelector('[data-opt-body]');
    if (!b) {
      if (!sec.querySelector('h2')) {
        sec.insertAdjacentHTML('afterbegin', '<h2 id="prf-opt-h">What the numbers would pick</h2><p class="po-note">This is what the history and current outlook point to, not advice. RMA rates already price most of this in.</p>');
      }
      b = document.createElement('div'); b.setAttribute('data-opt-body', ''); sec.appendChild(b);
    }
    return b;
  }

  /* the national test closest to the reader's coverage */
  function national(cov, objective) {
    if (!state.opt || !state.opt.results) return null;
    var keys = Object.keys(state.opt.results).filter(function (k) { return k.split('_')[1] === objective; });
    var best = null;
    keys.forEach(function (k) { var c = +k.split('_')[0]; if (!best || Math.abs(c - cov) < Math.abs(best.c - cov)) best = { c: c, k: k }; });
    return best ? { cov: best.c, r: state.opt.results[best.k], sample: state.opt.sample } : null;
  }

  function nationalSentence(nat, objective) {
    if (!nat) return 'The test across other grids did not load, so only this grid’s record is shown.';
    var r = nat.r, s = nat.sample;
    var who = 'Across ' + r.grids.toLocaleString('en-US') + ' grids in ' + s.states + ' states, tested at ' + nat.cov + '% coverage, ';
    if (objective === 'dry') {
      var dAhead = r.dryYears.opt > r.dryYears.even;
      return who + 'picking for the driest years from the years before ' + (dAhead ? 'came out ahead of' : 'would not have beaten') + ' an even spread in later dry years ('
        + per100(r.dryYears.opt) + ' against ' + per100(r.dryYears.even) + ' a year per $100 of protection), and was ahead in ' + r.yearsAheadOfEven + ' of ' + r.years.n + ' years overall.';
    }
    var ahead = r.mean.opt > r.mean.even;
    var hist = r.mean.hist == null ? '' : ' Picking from each grid’s own record alone, without the rates, ' + (r.mean.hist > r.mean.even ? 'also came out ahead' : 'did worse than an even spread') + ' (' + per100(r.mean.hist) + ').';
    var single = r.gridYearsBehindEvenPct > 50 ? ' In a single year it was behind more often than not (' + pctTxt(r.gridYearsBehindEvenPct) + ' of grid-years): it costs more, and gets ahead in the dry years.' : '';
    return who + (ahead
      ? 'this pick came out ahead of an even spread in ' + pctTxt(r.gridsAheadOfEvenPct) + ' of grids from ' + r.years.first + ' to ' + r.years.last + ', and in '
        + r.yearsAheadOfEven + ' of ' + r.years.n + ' years (' + per100(r.mean.opt) + ' against ' + per100(r.mean.even) + ' a year per $100 of protection).' + single + hist
      : 'picking months this way would not have beaten an even spread from ' + r.years.first + ' to ' + r.years.last + ' (' + per100(r.mean.opt) + ' against ' + per100(r.mean.even) + ' a year per $100 of protection).' + hist);
  }

  function compute(ctx) {
    var mm = ctx.limits || {};
    var outl = state.outlookJson ? O.outlookFor(state.outlookJson, ctx.grid) : { outlook: null, enso: null };
    state.ensoFromFile = outl.enso;
    var enso = state.enso === 'none' ? null : (state.enso || outl.enso || null);
    var key = [ctx.grid, ctx.cov, JSON.stringify(mm.min), JSON.stringify(mm.max), state.objective, enso, outl.outlook ? JSON.stringify(outl.outlook) : '', ctx.lastComplete, (state.kept || []).join(',')].join('|');
    if (state.cache.key === key) return state.cache.res;
    var res = O.recommend({ index: ctx.index, rates: ctx.rates ? ctx.rates[ctx.cov] : null, coverage: ctx.cov, subsidy: ctx.subsidy ? ctx.subsidy[String(ctx.cov)] : null,
                            min: mm.min, max: mm.max, valid: mm.valid, avgMm: ctx.avgMm, lastComplete: ctx.lastComplete },
                          { objective: state.objective, enso: enso, outlook: outl.outlook, tilts: state.kept || [], climate: state.climate || null, policyYear: ctx.cropYear || null });
    res.outlookMeta = outl;
    res.ensoUsed = enso;
    state.cache = { key: key, res: res };
    return res;
  }

  /* dollars of protection for the reader's acres: what every per-$1 figure is multiplied by */
  function protection(ctx) {
    if (!(ctx.cbv > 0) || !(ctx.acres > 0)) return null;
    var ppa = Math.floor(ctx.cbv * ctx.cov * ctx.pf / 100 + 0.5) / 100;   /* cents, as prf-math.js */
    return ppa * ctx.acres * (ctx.share == null ? 1 : ctx.share / 100);
  }

  function row(label, rec, prot, note) {
    if (!rec) return '<tr><td><b>' + esc(label) + '</b></td><td colspan="5">' + esc(note || 'not available in this county') + '</td></tr>';
    var r = rec.record;
    return '<tr><td><b>' + esc(label) + '</b><br><span class="po-fine">' + esc(splitWords(rec.split)) + '</span></td>'
      + '<td data-l="You pay a year">' + usd(r.premium * prot) + '</td><td data-l="Average after premium">' + signed(r.mean * prot) + '</td><td data-l="Middle year">' + signed(r.mid * prot) + '</td>'
      + '<td data-l="Worst and best year">' + signed(r.worst.net * prot) + ' (' + r.worst.year + '), ' + signed(r.best.net * prot) + ' (' + r.best.year + ')</td>'
      + '<td data-l="Years it paid">' + r.paidYears + ' of ' + r.n + '</td></tr>';
  }

  function draw() {
    var ctx = state.ctx, b = body();
    if (!b || !ctx) return;
    css();
    if (!ctx.index || !ctx.rates || !ctx.limits) { b.innerHTML = '<p class="po-fine">Pick a grid and county above to see what the numbers would pick.</p>'; return; }
    var res = compute(ctx);
    if (!res.ok) { b.innerHTML = '<p class="po-fine">' + esc(res.why) + '</p>'; return; }
    var prot = protection(ctx), nat = national(ctx.cov, state.objective), bt = res.backtest;
    var h = '';
    var ns = nationalSentence(nat, state.objective), cut = ns.indexOf('. ') + 1;
    h += '<p class="po-verdict">' + esc(cut > 0 ? ns.slice(0, cut) : ns) + '</p>' + (cut > 0 ? '<p class="po-fine">' + esc(ns.slice(cut + 1)) + '</p>' : '');
    h += '<div class="po-tabs" role="group" aria-label="What to make best">'
      + '<button type="button" class="po-tab' + (state.objective === 'net' ? ' is-on' : '') + '" data-opt-obj="net" aria-pressed="' + (state.objective === 'net') + '">Most expected dollars</button>'
      + '<button type="button" class="po-tab' + (state.objective === 'dry' ? ' is-on' : '') + '" data-opt-obj="dry" aria-pressed="' + (state.objective === 'dry') + '">Most in the driest years</button></div>';
    h += '<p class="po-fine">Shown: ' + (state.objective === 'net'
      ? 'the split with the highest expected payment minus your share of the premium, at ' + ctx.cov + '% coverage, from RMA’s 2027 rates and this grid’s record.'
      : 'the split that would have paid most, after your share of the premium, in the driest fifth of years here (by whole-year precipitation), at ' + ctx.cov + '% coverage.') + '</p>';

    var pk = res.forecast || res.rec, sp = pk.split;
    var tiltOnly = res.forecast && !res.forecast.enso && !res.forecast.outlook;
    h += '<h3>' + (res.forecast ? (tiltOnly ? 'The pick, with what held up in the test' : 'The pick, with this fall’s outlook') : 'The pick') + ' for grid ' + esc(ctx.grid) + (ctx.county ? ', ' + esc(ctx.county) : '') + '</h3>';
    h += '<div class="po-split">';
    for (var i = 0; i < N; i++) if (sp[i]) h += '<div class="po-iv"><b>' + sp[i] + '%</b><span>' + LABELS[i] + '</span></div>';
    h += '</div>';
    h += '<button type="button" class="po-use" data-opt-use="' + sp.join('.') + '">Use this setup in the calculator above</button>';

    if (prot) {
      h += '<p class="po-fine">About, for ' + esc(ctx.acres.toLocaleString('en-US')) + ' acres at ' + ctx.cov + '% coverage and productivity factor ' + ctx.pf
        + ', every year ' + res.years.first + ' to ' + res.years.last + ' at 2027 rates. The calculator above gives the exact dollars.</p>'
        + '<div class="po-wrap"><table aria-label="The pick beside other setups"><thead><tr><th scope="col">Setup</th><th scope="col">You pay a year</th><th scope="col">Average after premium</th><th scope="col">Middle year</th><th scope="col">Worst and best year</th><th scope="col">Years it paid</th></tr></thead><tbody>';
      if (res.forecast) h += row(tiltOnly ? 'With what held up' : 'With the outlook', res.forecast, prot);
      h += row(res.forecast ? 'Record alone' : 'This pick', res.rec, prot);
      if (res.naive && res.naive.split.join() !== res.rec.split.join()) h += row('Grid’s own record alone', res.naive, prot);
      h += row('Even spread', res.base.even, prot);
      h += row('The page’s example (Apr-May, Jun-Jul)', res.base.def, prot, 'not offered in this county');
      h += row('Two driest months', res.base.dry2, prot);
      h += '</tbody></table></div>';
    } else {
      h += '<p class="po-fine">Enter acres above to see these in dollars.</p>';
    }

    /* this grid's own out-of-sample record, verdict first */
    if (bt) {
      var vs = state.objective === 'dry' ? bt.dryVsEven : bt.vsEven;
      h += '<h3>Would it have worked here?</h3><p class="po-verdict">' + esc(bt.verdict.text) + '</p><p class="po-fine">';
      if (state.objective === 'dry') {
        h += 'Picked each fall from only the years before, then scored on the next year: in the ' + vs.n + ' dry years from ' + bt.first + ' to ' + bt.last
          + ' it beat an even spread in ' + vs.wins + '. Too few dry years in one grid to tell skill from luck; the test across grids above is the better guide.';
      } else {
        h += 'Picked each fall from only the years before, then scored on the next year, ' + bt.first + ' to ' + bt.last + ' (' + vs.n + ' years): ahead of an even spread in '
          + vs.wins + ', behind in ' + vs.losses + (vs.ties ? ', even in ' + vs.ties : '') + '. On average ' + (prot ? signed(vs.meanDiff * prot) + ' a year for these acres' : per100(vs.meanDiff) + ' per $100 of protection')
          + (vs.p >= 0.2 ? '. A gap this size turns up by luck alone ' + (vs.p >= 0.5 ? 'more often than not' : 'often') + ', so it says little either way.' : '. Odds that luck alone gives a gap this size: ' + pOdds(vs.p) + '.');
        var en = bt.ensoVsHistory;
        if (en && en.n) h += ' Weighting years by the fall’s El Niño or La Niña reading changed the result by ' + (prot ? signed(en.meanDiff * prot) : per100(en.meanDiff)) + ' a year on average here (better in ' + en.wins + ' years, worse in ' + en.losses + ').';
      }
      h += '</p>';
    }

    /* the outlook */
    var om = res.outlookMeta || {};
    h += '<h3>This fall’s outlook</h3><div class="po-row"><label for="prf-opt-enso">El Niño or La Niña this fall</label><select id="prf-opt-enso">'
      + [['', om.enso ? 'From NOAA (' + O.PHASE_NAME[om.enso] + ')' : 'Not set'], ['el-nino', 'El Niño'], ['neutral', 'Neutral'], ['la-nina', 'La Niña'], ['none', 'Leave it out']].map(function (o) {
        var on = (state.enso || '') === o[0];
        return '<option value="' + o[0] + '"' + (on ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></div>';
    h += '<p class="po-fine">' + (om.outlook ? 'NOAA’s seasonal precipitation outlook' + (om.issued ? ' issued ' + esc(om.issued) : '') + ' is in. ' : 'NOAA’s seasonal precipitation outlook is not loaded, so no month is tilted by it. ')
      + (res.forecast ? esc(res.forecast.notes.join(' ')) : 'With no outlook set, the pick uses the record and the rates alone.' + (res.tiltNotes && res.tiltNotes.length ? ' ' + esc(res.tiltNotes.join(' ')) : ''))
      + ' The El Niño and La Niña weighting was tested above; NOAA’s monthly outlook could not be, because past outlooks are not in the data.</p>';

    h += '<h3>Why these months</h3><ul class="po-why">' + res.reasons.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';

    h += tested();
    h += '<details><summary>Show the arithmetic</summary><div class="po-fine">'
      + '<p>Every interval’s payment in every year is the policy’s own rule: (trigger minus index) over trigger, when the index is under the trigger, times the protection. Premium is RMA’s 2027 rate times the protection; you pay what is left after USDA’s ' + Math.round(res.subsidy * 100) + '%.</p>'
      + '<p>“Most expected dollars” rates each interval by RMA’s 2027 rate times this grid’s payback on its rates over all offered intervals and years, less your share. It then searches every split the rules allow (whole percents, at least two intervals, no month twice, each between the county’s minimum and maximum, January and February at most 25%) for the highest total. The grid’s own record for each interval alone, without the rates, was also tested and did worse than an even spread across grids.</p>'
      + '<p>“Most in the driest years” uses the driest fifth of years by whole-year precipitation (the six intervals that share no month, weighted by their normal inches).</p>'
      + '<p>The test: each year from 1981, the pick is made from the years before it only, and the El Niño or La Niña reading of the August to October before, then scored on that year. Two things it cannot avoid: every year is scored at 2027 rates, which RMA set with the whole record in view, so this test flatters any pick that leans on rates; and USDA’s index is percent of a 1951 to 2025 normal.</p>'
      + '<p>El Niño and La Niña: years whose August to October reading matched this fall’s count double. ' + esc(O.ONI_SOURCE.years) + ' ' + esc(O.ONI_SOURCE.thresholds) + '.</p>'
      + (state.opt ? '<p>Test across grids: ' + esc(state.opt.sample.rule) + ', ' + state.opt.sample.grids.toLocaleString('en-US') + ' grids, built from the data of ' + esc(String(state.opt.built_from).slice(0, 10)) + '. Grids next to each other share weather, so years are the closer count of independent results.</p>' : '')
      + '<p>Figures in dollars leave out RMA’s rounding of each unit to the dollar, so they can differ from the calculator by a few dollars.</p>'
      + '</div></details>';
    b.innerHTML = h;
  }

  /* Every idea the test across grids tried, one plain line each, the ones that
     failed included. Lines and verdicts come from data/prf/opt.json
     (scripts/prf_opt_backtest.mjs); nothing here judges them. */
  function tested() {
    var o = state.opt, pr = o && o.predictors, fam = o && o.family;
    var h = '<details><summary>What we tested</summary><div class="po-fine">';
    if (!pr || !fam) return h + '<p>The test across grids did not load, so the list of what was tried is not shown. Without it, nothing but the record and the rates moves the pick.</p></div></details>';
    var kept = state.kept || [];
    h += '<p>Other weather signals, each tried as a tilt on the pick above and scored the same way: picked each fall from the years before, then scored on the next year, across '
      + o.sample.grids.toLocaleString('en-US') + ' grids, 1981 to ' + o.last_complete + '. ' + fam.size + ' comparisons were promised and are counted together (' + fam.run
      + ' run so far); by luck alone about ' + fam.expectedByChanceAt5pct + ' of them would look like a find, so each is judged after that count. '
      + (kept.length ? 'Only what held up after the count moves the pick.' : 'None held up after the count, so none of these moves the pick.') + '</p><ul class="po-why">';
    Object.keys(pr).forEach(function (id) { h += '<li>' + esc(pr[id].line) + '</li>'; });
    return h + '</ul></div></details>';
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-opt-obj],[data-opt-use]') : null;
    if (!t) return;
    if (t.hasAttribute('data-opt-obj')) { state.objective = t.getAttribute('data-opt-obj'); draw(); return; }
    var split = t.getAttribute('data-opt-use').split('.').map(Number);
    if (state.ctx && typeof state.ctx.apply === 'function') state.ctx.apply(split);
    else { try { root.dispatchEvent(new CustomEvent('prf:use-split', { detail: { split: split } })); } catch (er) {} }
    try { if (typeof root.gtag === 'function') root.gtag('event', 'prf_opt_use', { objective: state.objective }); } catch (er2) {}
  }
  function onChange(e) {
    if (e.target && e.target.id === 'prf-opt-enso') { state.enso = e.target.value || null; draw(); }
  }
  var wired = false;
  function wire() {
    var sec = section(); if (!sec || wired) return;
    sec.addEventListener('click', onClick);
    sec.addEventListener('change', onChange);
    wired = true;
  }

  /* ctx: { grid, county, index (complete years), rates (by coverage), avgMm,
            limits {min,max,valid}, cov, pf, acres, share, cbv, subsidy (by
            coverage), lastComplete, cropYear (optional, the policy year being
            picked), src, apply(split) } */
  function update(ctx) {
    state.ctx = ctx;
    if (!section()) return;
    wire();
    if (!state.loaded) { load(ctx.src || '/data/prf/').then(draw); var b = body(); if (b && !b.innerHTML) b.innerHTML = '<p class="po-fine">Working it out…</p>'; return; }
    draw();
  }

  root.AgPrfOptUI = { update: update, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
