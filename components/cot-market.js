/* /cot "One market at a time": the studies, what followed, the past weeks that
   look like today and the arithmetic, for one market.

   DEPTH ON DEMAND (2026-10-15). This used to ship inside cot.html on every
   load, 25 KB of code for a panel most readers never scroll to. It now loads
   only when a market is opened (a card or picker tap, or the panel coming
   into view), per CLAUDE.md. components/cot-analysis.js owns the data, the
   vintage guard and the helpers, and hands them over through `api`; this file
   owns the pixels and the words of the panel and nothing else. */
window.cotMarket = function (api) {
  'use strict';
  var $ = api.$, num = api.num, sgn = api.sgn, pct = api.pct, ord = api.ord, dt = api.dt,
      narrow = api.narrow, crowdWord = api.crowdWord, HOT = api.HOT, GREY = api.GREY;

  /* ── distribution strip ────────────────────────────────────────────────── */
  function strip(st, base, h, showLegend){
    if (!st || st.verdict !== 'measured') return '';
    if (!base || base.q10 == null || base.q90 == null) return '';
    var lo = Math.min(st.q10, base.q10, 0), hi = Math.max(st.q90, base.q90, 0);
    var pad = Math.max(1, (hi - lo) * 0.08); lo -= pad; hi += pad;
    var nw = narrow();
    var W = nw ? 360 : 700, L = nw ? 8 : 140, R = nw ? 10 : 16;
    var T = nw ? 30 : 16, rowH = nw ? 52 : 34;
    var H = T + rowH*2 + (nw ? 22 : 34), FS = nw ? 11 : 9.5, cw = W - L - R;
    var X = function(v){ return L + ((v - lo)/(hi - lo)) * cw; };
    var s = ['<svg viewBox="0 0 '+W+' '+H+'" style="font-size:'+FS+'px" role="img" aria-label="'
      + h + '-week outcomes. Weeks like this one: middle outcome ' + st.median
      + ' percent, half of them between ' + st.q25 + ' and ' + st.q75
      + ' percent. Every week on record: middle outcome ' + base.median + ' percent.">'];
    s.push('<line x1="'+X(0)+'" y1="'+(T-8)+'" x2="'+X(0)+'" y2="'+(T+rowH*2-6)+'" stroke="var(--border)" stroke-width="1"/>');
    s.push('<text x="'+X(0)+'" y="'+(T+rowH*2+12)+'" text-anchor="middle">0%</text>');
    [lo + (hi-lo)*0.02, hi - (hi-lo)*0.02].forEach(function(v){
      s.push('<text x="'+X(v)+'" y="'+(T+rowH*2+12)+'" text-anchor="'+(v<0?'start':'end')+'">'+sgn(v,0)+'%</text>');
    });
    function band(y, q){
      return '<line x1="'+X(q[0])+'" y1="'+(y+9)+'" x2="'+X(q[4])+'" y2="'+(y+9)+'" stroke="'+q[5]+'" stroke-width="2" opacity=".55"/>'
        + '<rect rx="3" x="'+X(q[1])+'" y="'+y+'" width="'+Math.max(2,(X(q[3])-X(q[1])))+'" height="18" fill="'+q[5]+'" opacity=".38"/>'
        + '<line x1="'+X(q[2])+'" y1="'+(y-2)+'" x2="'+X(q[2])+'" y2="'+(y+20)+'" stroke="'+q[6]+'" stroke-width="2.5"/>';
    }
    var A = [st.q10, st.q25, st.median, st.q75, st.q90, HOT, HOT];
    var Bq = [base.q10, base.q25, base.median, base.q75, base.q90, GREY, 'rgba(233,237,235,.8)'];
    if (nw) {
      s.push('<text x="'+L+'" y="'+(T-9)+'" fill="var(--text-dim)">Weeks like this one</text>' + band(T, A));
      s.push('<text x="'+L+'" y="'+(T+rowH-9)+'">Every week on record</text>' + band(T+rowH, Bq));
    } else {
      s.push('<text x="'+(L-10)+'" y="'+(T+13)+'" text-anchor="end" fill="var(--text-dim)">Weeks like this one</text>' + band(T, A));
      s.push('<text x="'+(L-10)+'" y="'+(T+rowH+13)+'" text-anchor="end">Every week on record</text>' + band(T+rowH, Bq));
    }
    s.push('</svg>');
    return '<div class="cx-dist">' + s.join('') + '</div>'
      + (showLegend ? '<p class="cx-foot">Bar is the middle half of outcomes, the line through it the '
          + 'middle outcome, the whisker the 10th to 90th.</p>' : '');
  }

  /* ── one market ────────────────────────────────────────────────────────── */
  function verdictLine(c){
    var best = null;
    for (var h in c.studies) {
      for (var nm in c.studies[h]) {
        var st = c.studies[h][nm];
        if (st.verdict === 'measured' && st.fdr_pass) { best = { h: h, st: st }; break; }
      }
    }
    if (best) {
      return '<p class="cx-verdict pass"><b>One reading held up.</b> ' + esc(best.st.question)
        + ' Over ' + best.h + ' weeks the middle outcome was ' + sgn(best.st.median) + '%, against '
        + sgn(best.st.base_median) + '% for an average week, and it survived the correction for every '
        + 'test we ran. Details below.</p>';
    }
    /* No hard 90/10 cliff. A market at the 89th percentile is not "close to
       normal", and a tenth of a point should not flip a reader between
       "protect what you have unpriced" and "nothing to do". The wording now
       tracks the percentile continuously, and the exposure noun comes from the
       group, because "unpriced bushels" was about to render under Feeder
       Cattle and Class III Milk. */
    var p = c.pctl.net_oi_all;
    var noun = c.exposure_noun || 'unpriced production';
    var side = c.net > 0 ? 'long' : 'short';
    var room = c.net > 0 ? c.capacity.room_down : c.capacity.room_up;
    var dir = c.net > 0 ? 'selling' : 'buying';
    if (p !== null && (p >= 75 || p <= 25)) {
      /* ONE CROWDING PHRASE (2026-10-16 head to head). This said "an unusually
         large net long" at the 81st percentile while The Read and the card
         said "high side, not crowded" for the same number. The words now come
         from crowdWord() and the pipeline's crowded flag, the same as The Read. */
      var where = crowdWord(p) + ', ' + (c.crowded ? 'crowded ' + c.crowded : 'not crowded');
      return '<p class="cx-verdict warn"><b>No timing signal, but a real exposure.</b> Funds hold '
        + 'a net ' + side + ' in ' + esc(c.label) + ' at the ' + ord(p) + ' percentile of their own record since '
        + c.first_week.slice(0,4) + ' (' + where + '). Nothing we tested says which way price goes next. What it does '
        + 'say is that ' + num(c.capacity.to_flat) + ' contracts of ' + dir + ' sit between here and '
        + 'flat, and ' + num(room) + ' between here and the far end of that record (as a share of open interest, at today\'s open interest). That is a reason '
        + 'to look this week at ' + esc(noun) + ', not a reason to predict a move.</p>';
    }
    // 2026-09-25 audit: this said "None of the readings we tested beat an average week" for Live Cattle while the
    // same panel showed a 4-week flow reading at 78% against 64% (p = 0.03). Say what is true: one may look
    // better than average on its own, and none survives the correction for testing many readings.
    var _sug = false, _hz = c.studies || {};
    Object.keys(_hz).forEach(function(k){ var g = _hz[k] || {}; Object.keys(g).forEach(function(n){ var t = g[n]; if (t && t.verdict === 'measured' && !t.fdr_pass && t.p !== null && t.p < 0.05) _sug = true; }); });
    return '<p class="cx-verdict"><b>Nothing here should change your marketing plan this week.</b> '
      + esc(c.read) + (_sug ? ' One reading looks better than an average week on its own, but it does not survive the correction for testing this many at once.'
                            : ' None of the readings we tested beat an average week.') + '</p>';
  }

  function plainResult(st, h, label) {
    if (st.verdict !== 'measured') {
      return '<div class="cx-withheld"><b>Not enough history to say.</b> ' + esc(st.why) + '</div>';
    }
    var upDiff = Math.round((st.hit_up - st.base_hit_up) * 100);
    var medDiff = (st.median !== null && st.base_median !== null) ? Math.abs(st.median - st.base_median) : 0;
    // 2026-09-25 audit: "Coin flip." was printed for every p >= 0.05, including 73% against 49% and a +1.9% middle
    // outcome against -0.1% (corn, 4-week flow, p = 0.21). Absence of evidence is not evidence of no edge: when
    // the gap is large and the evidence is thin, say that.
    var bigGap = Math.abs(upDiff) >= 10 || medDiff >= 1;
    var word = st.fdr_pass ? 'This one held up.'
      : (st.p !== null && st.p < 0.05 ? 'Suggestive, but it does not survive the batch.'
      : (bigGap ? 'A big gap, but too few separate spells to trust it.' : 'Coin flip.'));
    var cls = st.fdr_pass ? 'pass' : 'weak';
    var pIn = st.p === null ? null : (st.p < 0.005 ? 'under 1' : String(Math.round(st.p*100)));
    return '<p class="cx-result ' + cls + '"><b>' + word + '</b> This was true in ' + st.n + ' weeks, in '
      + st.episodes + ' separate ' + (st.episodes === 1 ? 'spell' : 'spells') + ' (weeks in one spell overlap, '
      + 'so the evidence is nearer ' + st.episodes + ' than ' + st.n + '). Price was higher '
      + Math.round(st.hit_up*100) + '% of those weeks ' + h + ' weeks later, '
      + 'against ' + Math.round(st.base_hit_up*100) + '% in an average week'
      + (Math.abs(upDiff) >= 1 ? ' (' + (upDiff > 0 ? '+' : '\u2212') + Math.abs(upDiff) + ' points)' : '')
      + '. Middle outcome ' + sgn(st.median) + '%, against ' + sgn(st.base_median) + '% for an average '
      + 'week. Half of them landed between ' + sgn(st.q25) + '% and ' + sgn(st.q75) + '%, the worst '
      + sgn(st.worst) + '%, the best ' + sgn(st.best) + '%.'
      + (pIn !== null ? ' How often chance alone would land this far from an average week: about ' + pIn + ' in 100.' : '')
      + '</p>';
  }

  function renderDeep(){
    var CX = api.cx(), CX_KEY = api.key(), CX_H = api.h();
    var host = $('cx-deep'); if (!host || !CX) return;
    var c = CX.commodities[CX_KEY];
    if (!c) { host.innerHTML = '<p class="cx-dim">No analysis for this market.</p>'; return; }
    var h = CX_H, S = (c.studies && c.studies[h]) || {}, base = c.base && c.base[h];
    var o = [];

    o.push('<h3 class="cx-market">' + esc(c.label) + '<span class="cx-market-date">positions as of '
      + dt(c.date) + ', published ' + dt(c.release_date) + '</span></h3>');
    o.push(verdictLine(c));
    o.push('<p class="cx-body">' + esc(c.read) + '</p>');

    o.push('<dl class="cx-grid">');
    var crowdHead = c.is_record_high && c.net > 0 ? 'record long'
                  : c.is_record_low && c.net < 0 ? 'record short'
                  : crowdWord(c.pctl.net_oi_all);
    /* ONE MEASURE IN THIS PANEL: net as a share of open interest, ranked over
       the whole record and counted toward the side the position is on. The
       rank used to be raw contracts ("Rank 1st of 874 by net position") beside
       a share-of-open-interest percentile, and "No week carries a bigger net
       long" fired on the second-highest week because 99.886 rounds to 99.9.
       It now fires only on rank 1, the record itself. */
    var longSide = c.net > 0;
    var ro = c.rank_oi;
    var since = c.first_week.slice(0,4);
    var rarer = c.pctl.net_oi_all === null ? null
              : (longSide ? 100 - c.pctl.net_oi_all : c.pctl.net_oi_all);
    var crowdNote = '';
    if (ro && ro.rank === 1) {
      crowdNote = 'No week since ' + since + ' carries a bigger net ' + ro.side + ' than this one, measured as a share of open interest ('
        + num(ro.of) + ' weeks). ';
    } else if (ro) {
      crowdNote = 'Rank ' + ord(ro.rank) + ' of ' + num(ro.of) + ' weeks since ' + since + ' by size of net ' + ro.side
        + ', measured as a share of open interest'
        + (rarer === null ? '' : ': funds have held a bigger net ' + ro.side + ' in ' + num(ro.rank - 1) + ' of them')
        + '.' + (ro.last_beyond ? ' Last bigger ' + dt(ro.last_beyond) + '.' : '') + ' ';
    }
    if (c.crowded) crowdNote += 'That is crowded: the ' + (c.crowded === 'long' ? 'top' : 'bottom')
      + ' tenth of the record on the side the position is on.';
    o.push(stat('How crowded', crowdHead, crowdNote));
    o.push(stat('Which way, and by how much', num(c.net),
      'contracts net ' + (c.net > 0 ? 'long' : 'short') + ', ' + pct(c.net_oi) + ' of all open contracts. '
      + (c.chg >= 0 ? 'Up ' : 'Down ') + num(Math.abs(c.chg)) + ' on the week'
      + (c.chg4 === null ? '' : ', ' + (c.chg4 >= 0 ? 'up ' : 'down ') + num(Math.abs(c.chg4)) + ' over four') + '.'
      + (c.mm_spread ? ' A further ' + num(c.mm_spread) + ' contracts are spread between months and are not in the net.' : '')));
    /* "If it unwound" printed the distance to the record on the OTHER side --
       a full reversal that has essentially never happened inside a quarter --
       under a label describing something else. Unwinding is going flat. Both
       are shown now, and the record is anchored in share of open interest and
       converted at today's open interest, because a raw-contract record set
       when the market was half this size is not a level it can return to. */
    var toward = c.net > 0 ? 'selling' : 'buying';
    var away   = c.net > 0 ? 'buying' : 'selling';
    o.push(stat('If it went flat', num(c.capacity.to_flat),
      'contracts of ' + toward + ', ' + pct(c.capacity.to_flat_oi) + ' of everything open in '
      /* NOT "BEYOND THAT", AND NOT "MORE". cot_analysis.py _room() measures to
         the record share FROM TODAY'S POSITION, so when today and the record sit
         on opposite sides of zero the number already contains to_flat. Printing
         it after "Beyond that ... more" added the distance to itself: corn read
         401,003 to flat and then 803,673 MORE, when 803,673 IS the whole distance
         and the increment is 402,670. Every market was overstated, 1.09x to 6.20x
         (Live Cattle printed 58,252 against a true 9,401). The sibling paragraph
         above words the same value as "between here and the far end" and was
         always right; only this sentence was wrong. */
      + esc(c.label) + ' today. From here it is '
      + num(c.net > 0 ? c.capacity.room_down : c.capacity.room_up)
      + ' to the far end of the record, and '
      + num(c.net > 0 ? c.capacity.room_up : c.capacity.room_down) + ' of ' + away
      + ' to the near end. Both ends are the record share of open interest, valued at today\'s open interest. Positioning has no mechanical effect on price. This is the size of the '
      + 'position, not a forecast of a move.'));
    o.push('</dl>');

    /* who took the other side */
    if (c.decomposition && c.decomposition.length) {
      o.push('<h4 class="cx-h4">Who took the other side</h4>');
      o.push('<p class="cx-sub">Every contract has two sides, so the five categories net to zero. '
        + 'This is the part of the report that says where a fund position actually came from. '
        + 'In grain markets the swap dealer line is where index money sits.</p>');
      var t = ['<thead><tr><th>Category</th><th>Net</th><th>% of open</th><th>Week</th></tr></thead><tbody>'];
      c.decomposition.forEach(function(r){
        t.push('<tr' + (r.key === 'mm' ? ' class="cx-row-hi"' : '') + '><td>' + esc(r.label) + '</td><td>'
          + num(r.net) + '</td><td>' + pct(r.oi) + '</td><td>' + (r.chg >= 0 ? '+' : '−')
          + num(Math.abs(r.chg)) + '</td></tr>');
      });
      o.push('<div class="cx-tw"><table class="cx-table">' + t.join('') + '</tbody></table></div>');
      if (c.commercial && c.commercial.who) {
        /* A static "structurally short" blurb above a net long number is the
           page contradicting itself on screen. When the commercials are
           against type, that is the most interesting line on the panel. */
        var note = esc(c.commercial.who);
        if (c.commercial.against_type) {
          note += ' <b>This week they are net long ' + num(c.commercial.net)
            + (c.commercial.pctl_all === null ? '' : ', the ' + ord(c.commercial.pctl_all)
               + ' percentile of their own record')
            + ', which is against type.</b>';
        }
        o.push('<p class="cx-foot">' + note + '</p>');
      }
    }

    if (c.crowding || c.seasonal) {
      o.push('<dl class="cx-grid">');
      if (c.crowding) {
        /* Measured on the side the position is actually on. Reporting the
           long side of a market whose whole story is a record short describes
           the wrong book. */
        o.push(stat('Average size per ' + c.crowding.side + ' fund',
          num(Math.round(c.crowding.per_trader)),
          'contracts each. ' + trCount(c.crowding.traders_long) + ' hold the long side, '
          + trCount(c.crowding.traders_short) + ' the short. Measured against this market\u2019s own '
          + 'average book over the last three years, that is the ' + ord(c.crowding.pctl) + ' percentile'
          /* 90/10, the page's one cut-off for "unusual" positioning. */
          + (c.crowding.pctl >= 90 ? ': held by fewer, larger hands than usual.'
             : c.crowding.pctl <= 10 ? ': unusually spread out.' : ', which is normal.')));
      }
      if (c.seasonal) {
        o.push(stat('Vs this week of the year', sgn(c.seasonal.deviation, 1) + ' pts',
          'In week ' + c.seasonal.week + ', across ' + c.seasonal.years + ' years, funds have usually '
          + 'held ' + pct(c.seasonal.median_net_oi) + ' of open contracts. They hold '
          + pct(c.seasonal.now_net_oi) + ' now.'));
      }
      o.push('</dl>');
    }

    /* what followed */
    o.push('<h4 class="cx-h4">What followed, the last time it looked like this</h4>');

    /* A market with no price series has no forward returns, so every study
       comes back with zero usable weeks and the gate prints "not enough
       history to say". That is true and it is the wrong reason: the history
       is complete, the PRICES are missing. Printing the thin-sample message
       here would send a reader looking for more history that already exists.
       Say the real reason once and stop. */
    if (base && !base.n) {
      o.push('<div class="cx-withheld"><b>No price read for ' + esc(c.label) + ': '
        + esc(c.price_withheld_reason || 'no forward returns this week') + '.</b> The positioning above is '
        + 'CFTC\u2019s and is complete, all ' + num(c.weeks_of_history) + ' weeks of it. Everything on this '
        + 'page that needs a price, what followed last time, the past weeks that look like today, '
        + 'the correlations, is withheld for this market for that reason. It is not a thin sample; '
        + 'it is no sample.</div>');
      o.push('<details class="cx-details"><summary>Show the arithmetic behind this panel</summary>'
        + '<div class="cx-tw"><table class="cx-table"><tbody>'
        + row('Report', 'CFTC Disaggregated, futures only, all contract months')
        + row('Positions as of', dt(c.date))
        + row('Published', dt(c.release_date))
        + row('Weeks on record', num(c.weeks_of_history) + ' from ' + dt(c.first_week))
        + row('Managed money long / short', num(c.mm_long) + ' / ' + num(c.mm_short))
        + row('Net, long minus short', num(c.net))
        + row('Open interest', num(c.oi))
        + row('Net as a share of open interest', pct(c.net_oi, 2))
        + row('Price series', esc(c.price_withheld_reason || 'none available'))
        + '</tbody></table></div></details>');
      host.innerHTML = o.join('');
      return;
    }
    o.push('<p class="cx-foot" style="margin-top:0">Percentages are the futures board, not your cash '
      + 'price. Basis moves separately.</p>');
    o.push('<div class="cx-hz" role="group" aria-label="How far ahead">'
      + ['4','8','13'].map(function(x){
          return '<button type="button" data-h="'+x+'" aria-pressed="'+(x===h)+'">'+x+' weeks</button>';
        }).join('') + '</div>');

    var order = ['positioning','share_of_oi','flow'], any = false, first = true;
    order.forEach(function(name){
      var st = S[name]; if (!st) return;
      any = true;
      o.push('<div class="cx-study">');
      o.push('<p class="cx-question">' + esc(st.question) + '</p>');
      o.push(plainResult(st, h, name));
      var sv = strip(st, base, h, first);
      if (sv) { o.push(sv); first = false; }
      o.push('</div>');
    });
    if (!any) {
      /* Two different reasons for an empty panel, and they must not read the
         same. One is "nothing unusual is happening", the other is "we have no
         price series for this market at all" -- which is the state Minneapolis
         wheat was in on the first real run, while sitting at the 99th
         percentile. */
      var noPrice = (c.base && c.base['8'] && !c.base['8'].n);
      o.push('<div class="cx-withheld">' + (noPrice
        ? '<b>No price read for ' + esc(c.label) + ': ' + esc(c.price_withheld_reason || 'no forward returns this week')
          + '.</b> The positioning figures above are CFTC\u2019s and are complete. Everything that needs a '
          + 'price, what followed last time, the analogs, the correlations, is withheld for that reason.'
        : 'Positioning in ' + esc(c.label) + ' is close enough to normal this week that there is no '
          + 'unusual condition to test. Most weeks look like this.'
          ) + '</div>');
    }

    /* analogs */
    if (c.analogs && c.analogs.length) {
      var ups = c.analogs.filter(function(a){ return a.fwd13 > 0; }).length;
      var lo13 = Math.min.apply(null, c.analogs.map(function(a){ return a.fwd13; }));
      var hi13 = Math.max.apply(null, c.analogs.map(function(a){ return a.fwd13; }));
      o.push('<h4 class="cx-h4">The past weeks that look most like today</h4>');
      o.push('<p class="cx-sub">Matched on five things at once: how stretched the funds are, their '
        + 'share of open contracts, how fast they have just moved, where the commercials sit, and '
        + 'price momentum. Picks are at least six months apart, because two weeks from the same '
        + 'month are really one piece of evidence.</p>');
      /* On a phone five columns clip the last one, and a clipped percentage
         reads as a broken table. Show the horizon the reader has selected. */
      var cols = narrow() ? ['fwd' + h] : ['fwd4','fwd8','fwd13'];
      var head = narrow() ? ['Then +' + h + 'wk'] : ['Then +4wk','+8wk','+13wk'];
      var t = ['<thead><tr><th>Week of</th><th>Match</th>'
        + head.map(function(x){ return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>'];
      c.analogs.forEach(function(a){
        t.push('<tr><td>' + dt(a.date) + '</td><td>' + a.distance.toFixed(2) + '</td>'
          + cols.map(function(f){
              return '<td>' + (a[f] === null || a[f] === undefined ? 'n/a' : sgn(a[f]) + '%') + '</td>';
            }).join('') + '</tr>');
      });
      o.push('<div class="cx-tw"><table class="cx-table">' + t.join('') + '</tbody></table></div>');
      var b13 = (c.base && c.base['13']) || {};
      var agree = Math.max(ups, c.analogs.length - ups);
      o.push('<p class="cx-foot"><b>' + ups + ' of these ' + c.analogs.length + ' went up over 13 weeks, '
        + (c.analogs.length - ups) + ' went down.</b> An average week in ' + esc(c.label) + ' was higher '
        + (b13.hit_up == null ? '-' : Math.round(b13.hit_up*100) + '%') + ' of the time, middle '
        + 'outcome ' + sgn(b13.median) + '%. Across these five the range was ' + sgn(lo13) + '% to '
        + sgn(hi13) + '%. '
        + (agree >= 4
            /* THE STATED ODDS WERE FOR A DIFFERENT EVENT THAN THE ONE TESTED.
               `agree` is Math.max(ups, downs), so this fires on four-or-five
               EITHER WAY. Under a fair coin that is P(#up in {0,1,4,5}) =
               12/32 = 37.5%, three times in eight. "One time in five" is 6/32 --
               the odds of four-or-five UP specifically, the one-sided event
               nobody is testing here. Understated by exactly 2x, in the one
               sentence whose job is to stop a reader over-reading the pattern. */
            ? 'Four or five the same way looks like agreement, and with five picks that happens by '
              + 'chance about three times in eight, so treat it as a prompt rather than a result.'
            : 'They disagree, which is the usual outcome.')
        + ' Lower match numbers are closer; anything above about 0.6 is a loose resemblance.</p>');
    }

    o.push('<details class="cx-details"><summary>Show the arithmetic behind this panel</summary>'
      + '<div class="cx-tw"><table class="cx-table"><tbody>'
      + row('Report', 'CFTC Disaggregated, futures only, all contract months')
      + row('Positions as of', dt(c.date))
      + row('Published', dt(c.release_date))
      + row('First close used for returns', dt(c.entry_date))
      + row('Weeks on record', num(c.weeks_of_history) + ' from ' + dt(c.first_week)
            + (c.gaps ? ' (' + c.gaps + ' non-weekly gaps)' : ''))
      + row('Managed money long / short', num(c.mm_long) + ' / ' + num(c.mm_short))
      + row('Managed money spreading (excluded from net)', num(c.mm_spread))
      + row('Net, long minus short', num(c.net))
      + row('Open interest', num(c.oi))
      + row('Net as a share of open interest', pct(c.net_oi, 2))
      + row('Rank by raw contracts (not size-adjusted)', ord(c.rank.desc) + ' highest of ' + num(c.rank.of) + ' weeks')
      + row('Report weeks not used as entry points (shutdown, release date unknown)', num(c.shutdown_excluded))
      + row('One contract is', num(c.contract_size) + ' ' + esc(c.unit))
      + row('The net position in ' + esc(c.unit), num(Math.abs(c.net) * c.contract_size)
            + ' ' + esc(c.unit) + ' net ' + (c.net > 0 ? 'long' : 'short'))
      + row('Producer / merchant net', num(c.commercial.net) + ' (' + pct(c.commercial.net_oi, 2) + ' of open interest)')
      + row('Price on the as-of Tuesday', c.price === null ? 'not available' : num(c.price))
      + '</tbody></table></div></details>');

    host.innerHTML = o.join('');
    Array.prototype.forEach.call(host.querySelectorAll('.cx-hz button'), function(b){
      b.addEventListener('click', function(){ api.setH(b.getAttribute('data-h')); });
    });
  }

  /* CFTC suppresses a trader count under four. The pipeline carries that as
     null; it is never zero funds holding a position. */
  function trCount(n){
    return (n === null || n === undefined) ? 'Fewer than 4 funds (CFTC suppresses the count)'
      : num(n) + ' fund' + (n === 1 ? '' : 's');
  }
  function stat(label, value, note){
    return '<div class="cx-stat"><dt>' + esc(label) + '</dt><dd>' + value
      + (note ? '<span class="cx-note">' + note + '</span>' : '') + '</dd></div>';
  }
  function row(a, b){ return '<tr><td>' + esc(a) + '</td><td>' + b + '</td></tr>'; }

  return { render: renderDeep };
};
