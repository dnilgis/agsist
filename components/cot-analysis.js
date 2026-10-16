/* /cot analysis engine: the board, the predictive test and the method notes.
   Moved out of cot.html 2026-10-15; the one-market panel loads on demand from
   components/cot-market.js. */
/* /cot — the analysis engine.
   Reads data/cot-analysis.json, written weekly by scripts/cot_analysis.py.
   Every section starts hidden. If the file is missing, or is on a different
   report date than data/cot.json, nothing below appears and the page is the
   page it was before. A stale panel under a fresh headline is worse than a
   missing one.
   The Python owns every statistic. This file owns pixels and wording. */
(function(){
  'use strict';

  var CX = null, CX_KEY = null, CX_H = '8', CX_POLL = null, VINTAGE_TRIES = 0;
  var HOT = '#d4a23f', COLD = '#5ba3e0', MID = 'rgba(233,237,235,.34)';
  var GREY = 'rgba(233,237,235,.55)';
  var SECTIONS = ['cx-board-sec','cx-pred-sec','cx-deep-sec','cx-method-sec'];

  function $(id){ return document.getElementById(id); }
  
  function num(n){ return (n === null || n === undefined || n !== n) ? '-' : Number(n).toLocaleString('en-US'); }
  function sgn(n, d){ if (n === null || n === undefined || n !== n) return '-';
    return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d === undefined ? 1 : d); }
  function k(n){ if (n === null || n === undefined || n !== n) return '-';
    var a = Math.abs(n), s = n < 0 ? '−' : '';
    return a >= 1000 ? s + (a/1000).toFixed(0) + 'k' : s + a; }
  function pct(n, d){ return (n === null || n === undefined || n !== n) ? '-' : Number(n).toFixed(d === undefined ? 1 : d) + '%'; }
  function ord(n){ n = Math.round(n); var v = n % 100;
    if (v >= 10 && v <= 20) return n + 'th';
    return n + ({1:'st',2:'nd',3:'rd'}[n % 10] || 'th'); }
  function dt(iso){
    if (!iso) return '-';
    var p = String(iso).split('-'); if (p.length !== 3) return iso;
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return m[parseInt(p[1],10)-1] + ' ' + parseInt(p[2],10) + ', ' + p[0];
  }
  function narrow(){ return typeof window !== 'undefined' && window.innerWidth < 620; }
  /* Hue says one thing on this page: how crowded. Nothing between the tenth
     and ninetieth percentile gets a colour, because most weeks are ordinary. */
  /* Coloured only when cot_analysis.py calls the market crowded: the full-record
     percentile of net as a share of open interest at or beyond 90/10 AND the
     position on that side of zero. One definition, computed in the pipeline. */
  function tone(cr){ return cr === 'long' ? HOT : cr === 'short' ? COLD : MID; }
  /* Five bands, not three. With "ordinary" spanning the 11th to the 89th
     percentile, a market at the 14th -- a deep fund short -- read exactly the
     same as one at the 89th. */
  function crowdWord(p){
    if (p === null || p === undefined) return 'no ranking';
    if (p >= 99) return 'top 1%';
    if (p >= 90) return 'top ' + Math.max(1, Math.round(100 - p)) + '%';
    if (p >= 75) return 'high side';
    if (p <= 1) return 'bottom 1%';
    if (p <= 10) return 'bottom ' + Math.max(1, Math.round(p)) + '%';
    if (p <= 25) return 'low side';
    return 'middling';
  }

  /* ── the board ─────────────────────────────────────────────────────────── */
  function points(){
    var out = [];
    for (var key in CX.commodities) {
      var c = CX.commodities[key];
      var x = c.pctl && c.pctl.net_oi_all, y = c.momentum13;
      if (x === null || x === undefined || y === null || y === undefined) continue;
      out.push({ key: key, label: c.label, x: x, y: y, net: c.net, crowded: c.crowded || null });
    }
    return out;
  }

  function drawBoard(){
    var svg = $('cx-board'), wrap = $('cx-board-wrap'), list = $('cx-ranked');
    if (!svg || !CX) return;
    var pts = points();

    /* Below 620px a 700-unit viewBox renders its labels at about five pixels.
       The list is not a fallback there, it is the better rendering. */
    if (narrow() || !pts.length) {
      wrap.style.display = 'none';
      list.style.display = 'block';
      var byX = pts.slice().sort(function(a,b){ return b.x - a.x; });
      list.innerHTML = byX.map(function(p){
        return '<li><button type="button" class="cx-rank" data-key="' + esc(p.key) + '">'
          + '<span class="cx-rank-dot" style="background:' + tone(p.crowded) + '"></span>'
          + '<span class="cx-rank-name">' + esc(p.label) + '</span>'
          + '<span class="cx-rank-pctl">' + crowdWord(p.x) + '</span>'
          + '<span class="cx-rank-mom">' + sgn(p.y) + '% / 13wk</span></button></li>';
      }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('.cx-rank'), function(b){
        b.addEventListener('click', function(){ selectKey(b.getAttribute('data-key'), true); });
      });
      if (!pts.length) list.innerHTML = '<li class="cx-dim">Price history has not caught up with this report yet. The figures below are unaffected.</li>';
    } else {
      wrap.style.display = '';
      list.style.display = 'none';
      paintScatter(svg, pts);
    }

    var b = CX.board;
    if (b && $('cx-board-note')) {
      /* Only name a market as stretched if it actually is. Printing the three
         highest under "most crowded long" puts the word over markets this page
         calls ordinary two lines further down. */
      var hot = b.stretched_long.filter(function(x){ return x.crowded === 'long'; });
      var cold = b.stretched_short.filter(function(x){ return x.crowded === 'short'; });
      var name = function(a){ return a.map(function(x){ return esc(x.label) + ' (' + crowdWord(x.pctl) + ')'; }).join(', '); };
      var txt = 'Average positioning across ' + b.n + ' markets sits at the ' + ord(b.mean_pctl)
        + ' percentile of its own record. ';
      if (!hot.length && !cold.length) {
        txt += 'None of them is in the top or bottom tenth of its history this week.';
      } else {
        txt += b.extremes + ' of them ' + (b.extremes === 1 ? 'is' : 'are') + ' crowded: in the top tenth of its record while net long, or the bottom tenth while net short. ';
        if (hot.length) txt += 'Crowded long: ' + name(hot) + '. ';
        if (cold.length) txt += 'Crowded short: ' + name(cold) + '.';
      }
      /* A market missing from the plot is not a market that does not matter.
         Minneapolis wheat was the most crowded long on the board and had no
         dot, because our futures feed carries no price for it. Say so under
         the picture rather than leaving a hole. */
      var plotted = {};
      pts.forEach(function(q){ plotted[q.key] = 1; });
      var absent = Object.keys(CX.commodities).filter(function(kk){ return !plotted[kk]; });
      if (absent.length && !narrow()) {
        /* The reason is the pipeline's, per market: Minneapolis wheat has no
           price series, lean hogs has one that is withheld. Saying "we have no
           price series" for both was wrong about hogs. */
        txt += ' <b>Not on the plot:</b> ' + absent.map(function(kk){
            var cc = CX.commodities[kk];
            return '<b>' + esc(cc.label) + '</b> (' + esc(cc.price_withheld_reason || 'no 13-week price change this week') + ')';
          }).join('; ') + '. There is no price change to place '
          + (absent.length === 1 ? 'it' : 'them') + ' against. The positioning figures are complete '
          + 'and in the table below.';
      }
      $('cx-board-note').innerHTML = txt;
    }

    /* WHAT MOVED. 84k contracts in corn and 28k in Chicago wheat are not the
       same event and the page had no way to say which was bigger. Ranked on
       the week's change as a share of open interest, scored against this
       market's own history of weekly changes. */
    var mv = (b && b.moves) || [];
    if (mv.length && $('cx-moved')) {
      var mr = ['<thead><tr><th>Market</th><th>Week change</th><th>% of open</th>'
        + '<th>vs its own weeks</th><th>Crowding</th></tr></thead><tbody>'];
      mv.slice(0, 6).forEach(function(m){
        /* No Greek letters. The reader who needs this column most is the one
           who has never seen a z-score, and the magnitude is already in the
           column to its left. */
        var zw = (m.z === null || m.z === undefined) ? '-'
               : Math.abs(m.z) >= 3 ? 'far bigger than usual'
               : Math.abs(m.z) >= 2 ? 'much bigger than usual'
               : Math.abs(m.z) >= 1 ? 'bigger than usual'
               : 'an ordinary week';
        mr.push('<tr><td>' + esc(m.label) + '</td><td>' + (m.chg >= 0 ? '+' : '\u2212')
          + num(Math.abs(m.chg)) + '</td><td>' + sgn(m.chg_oi, 2) + '%</td><td>' + zw
          + '</td><td>' + crowdWord(m.pctl)
          + (m.pctl_prev !== null && m.pctl_prev !== undefined && Math.abs(m.pctl - m.pctl_prev) >= 5
              ? ' <span class="cx-dim">(was ' + crowdWord(m.pctl_prev) + ')</span>' : '')
          + '</td></tr>');
      });
      $('cx-moved').innerHTML = '<div class="cx-tw"><table class="cx-table">' + mr.join('')
        + '</tbody></table></div>';
    }

    /* Replace the banner the cards wrote with the full-record version. */
    var vt = document.getElementById('cvb-text'), vb = document.getElementById('cvb-badge');
    if (vt && b) {
      var top = mv.length ? mv[0] : null;
      vt.innerHTML = (b.extremes === 0
          ? 'No market is crowded against its own record since '
            + String(CX.coverage.first_week).slice(0,4) + ' (top tenth while net long, bottom tenth while net short, as a share of open interest). '
          : b.extremes + ' of ' + b.n + ' markets are crowded against their own record since '
            + String(CX.coverage.first_week).slice(0,4) + ' (top tenth while net long, bottom tenth while net short, as a share of open interest). ')
        + (b.stretched_long.filter(function(x){return x.crowded==='long';}).length
            ? 'Crowded long: ' + b.stretched_long.filter(function(x){return x.crowded==='long';})
                .map(function(x){ return esc(x.label); }).join(', ') + '. ' : '')
        + (b.stretched_short.filter(function(x){return x.crowded==='short';}).length
            ? 'Crowded short: ' + b.stretched_short.filter(function(x){return x.crowded==='short';})
                .map(function(x){ return esc(x.label); }).join(', ') + '. ' : '')
        + (top ? 'Biggest move: ' + esc(top.label) + ' ' + (top.chg >= 0 ? '+' : '\u2212')
                 + num(Math.abs(top.chg)) + ' contracts, ' + sgn(top.chg_oi, 2) + '% of open interest. ' : '')
        + 'Which way they lean is a measure of who is exposed, not of where price is going.';
    }
    /* "0 stretched" as a headline badge reads like an error. The badge keeps
       the long/short count the cards wrote; the stretched count belongs in the
       sentence, where zero is a normal answer. */

    var rows = ['<thead><tr><th>Market</th><th>Net</th><th>% of open</th><th>Crowding</th><th>Price 13wk</th></tr></thead><tbody>'];
    Object.keys(CX.commodities).forEach(function(key){
      var c = CX.commodities[key];
      rows.push('<tr><td>' + esc(c.label) + '</td><td>' + num(c.net) + '</td><td>' + pct(c.net_oi)
        + '</td><td>' + crowdWord(c.pctl.net_oi_all) + '</td><td>' + sgn(c.momentum13) + '%</td></tr>');
    });
    $('cx-board-table').innerHTML = rows.join('') + '</tbody>';
  }

  function paintScatter(svg, pts){
    var W = 700, H = 448, L = 58, R = 20, T = 28, B = 62;
    var cw = W - L - R, ch = H - T - B, INSET = 10;
    var ys = pts.map(function(p){ return p.y; });
    /* Extra headroom top and bottom so a market at an extreme does not land
       on a corner caption. */
    var span = Math.max.apply(null, ys.concat([0])) - Math.min.apply(null, ys.concat([0]));
    var padY = Math.max(4, span * 0.12);
    var ymax = Math.max(12, Math.ceil((Math.max.apply(null, ys.concat([0])) + padY) / 5) * 5);
    var ymin = Math.min(-12, Math.floor((Math.min.apply(null, ys.concat([0])) - padY) / 5) * 5);
    var X = function(v){ return L + INSET + (v/100) * (cw - INSET*2); };
    var Y = function(v){ return T + (1 - (v - ymin)/(ymax - ymin)) * ch; };
    var s = [];

    s.push('<rect x="'+L+'" y="'+T+'" width="'+cw+'" height="'+ch+'" fill="rgba(128,128,128,.035)" rx="4"/>');
    /* The dividers sit at the 20th and 80th percentile, not the 50th. Half of
       every market is above its own median by definition. The corners are
       "high side" and "low side", NOT "crowded": crowded is 90/10 with the
       sign agreeing, the one definition every sentence on this page uses, and
       it is carried by the dot colour. */
    [20, 80].forEach(function(v){
      s.push('<line class="cx-axis" x1="'+X(v)+'" y1="'+T+'" x2="'+X(v)+'" y2="'+(T+ch)+'" stroke-dasharray="3 4"/>');
    });
    s.push('<line class="cx-axis" x1="'+L+'" y1="'+Y(0)+'" x2="'+(L+cw)+'" y2="'+Y(0)+'" stroke-dasharray="3 4"/>');
    [0,20,50,80,100].forEach(function(v){
      s.push('<text class="cx-axlab" x="'+X(v)+'" y="'+(T+ch+16)+'" text-anchor="middle">'+v+'</text>');
    });
    var step = Math.max(5, Math.round((ymax - ymin)/6/5)*5);
    for (var v = Math.ceil(ymin/step)*step; v <= ymax; v += step) {
      s.push('<text class="cx-axlab" x="'+(L-8)+'" y="'+(Y(v)+3.5)+'" text-anchor="end">'+(v>0?'+':'')+v+'%</text>');
    }
    s.push('<text class="cx-axlab" x="'+(L+cw/2)+'" y="'+(H-14)+'" text-anchor="middle">Fund positioning, percentile of its own record since '+String(CX.coverage.first_week).slice(0,4)+' (share of open contracts)</text>');
    s.push('<text class="cx-axlab" transform="translate(11,'+(T+ch/2)+') rotate(-90)" text-anchor="middle">Price, 13 weeks</text>');

    s.push('<text class="cx-quad" x="'+(L+cw-6)+'" y="'+(T+13)+'" text-anchor="end">High side, price rising</text>');
    s.push('<text class="cx-quad" x="'+(L+cw-6)+'" y="'+(T+ch-6)+'" text-anchor="end">High side, price falling</text>');
    s.push('<text class="cx-quad" x="'+(L+6)+'" y="'+(T+13)+'">Low side, price rising</text>');
    s.push('<text class="cx-quad" x="'+(L+6)+'" y="'+(T+ch-6)+'">Low side, price falling</text>');
    s.push('<text class="cx-quad" x="'+((X(20)+X(80))/2)+'" y="'+(T+ch/2-2)+'" text-anchor="middle" opacity=".5">Ordinary</text>');

    /* Every dot is named on the plot, so identity never depends on colour.
       Eleven labels in one box: take the side with room, then step vertically
       until nothing overlaps. The table below is the fallback. */
    var CHW = 5.9, LH = 12;
    pts.sort(function(a,b){ return Math.abs(b.x - 50) - Math.abs(a.x - 50); });
    /* Occupied before any label is placed: every dot, and the five fixed
       captions. Without the captions in this list a market at an extreme
       prints its name straight through the corner text, which is where the
       extremes are. */
    var placed = pts.map(function(q){ return [X(q.x)-8, Y(q.y)-8, X(q.x)+8, Y(q.y)+8]; });
    var QW = 5.1;
    [['High side, price rising', L+cw-6, T+13, 'end'],
     ['High side, price falling', L+cw-6, T+ch-6, 'end'],
     ['Low side, price rising', L+6, T+13, 'start'],
     ['Low side, price falling', L+6, T+ch-6, 'start'],
     ['Ordinary', (X(20)+X(80))/2, T+ch/2-2, 'middle']].forEach(function(q){
      var w = q[0].length * QW;
      var x0 = q[3] === 'end' ? q[1] - w : q[3] === 'middle' ? q[1] - w/2 : q[1];
      placed.push([x0 - 4, q[2] - 10, x0 + w + 4, q[2] + 4]);
    });
    pts.forEach(function(p){
      var px = X(p.x), py = Y(p.y), w = p.label.length * CHW + 13;
      var right = (px + w < L + cw - 4) && !(px - w > L + 4 && p.x > 62);
      function box(y){ return right ? [px+11, y-8, px+11+w, y+4] : [px-11-w, y-8, px-11, y+4]; }
      function hits(y){
        var b = box(y);
        for (var i = 0; i < placed.length; i++) {
          var o = placed[i];
          if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return true;
        }
        return false;
      }
      var ty = py + 3.6, tries = 0;
      while (hits(ty) && tries < 12) {
        tries++;
        ty = py + 3.6 + Math.ceil(tries/2) * LH * (tries % 2 ? 1 : -1);
      }
      ty = Math.max(T + 20, Math.min(T + ch - 6, ty));
      placed.push(box(ty));
      var lx = right ? px + 11 : px - 11;
      s.push('<g class="cx-dot" tabindex="0" role="button" data-key="'+esc(p.key)+'"'
        + ' aria-label="'+esc(p.label)+', positioning at the '+ord(p.x)+' percentile of its record, price '
        + (p.y>=0?'up ':'down ') + Math.abs(p.y).toFixed(1) + ' percent over 13 weeks. Opens this market below.">'
        + (Math.abs(ty - (py + 3.6)) > 7
            ? '<line x1="'+(right?px+4:px-4).toFixed(1)+'" y1="'+py.toFixed(1)+'" x2="'+lx.toFixed(1)+'" y2="'+(ty-3.4).toFixed(1)+'" stroke="var(--border)" stroke-width="1"/>' : '')
        + '<circle cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="6.5" fill="'+tone(p.crowded)+'"/>'
        + '<text x="'+lx.toFixed(1)+'" y="'+ty.toFixed(1)+'" text-anchor="'+(right?'start':'end')+'">'
        + esc(p.label) + '</text></g>');
    });
    svg.innerHTML = s.join('');
    Array.prototype.forEach.call(svg.querySelectorAll('.cx-dot'), function(g){
      var go = function(){ selectKey(g.getAttribute('data-key'), true); };
      g.addEventListener('click', go);
      g.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  /* ── does it predict ───────────────────────────────────────────────────── */
  function renderPredictive(){
    var host = $('cx-pred'), p = CX.predictive;
    if (!host) return;
    if (!p || !p.rows || !p.rows.length) { $('cx-pred-sec').className = 'cx'; return; }
    var sw = p.median_same_week, fw = p.median_forward, lv = p.median_level;
    var band = function(lo, hi){
      return (lo === null || lo === undefined || hi === null || hi === undefined)
        ? '' : '<span class="cx-big-ci">' + lo.toFixed(2) + ' to ' + hi.toFixed(2) + '</span>';
    };
    var med = function(f, l){
      var los = p.rows.map(function(r){ return r[f + '_lo']; }).filter(function(v){ return v != null; });
      var his = p.rows.map(function(r){ return r[f + '_hi']; }).filter(function(v){ return v != null; });
      if (!los.length) return '';
      los.sort(function(a,b){return a-b;}); his.sort(function(a,b){return a-b;});
      // 2026-09-25 audit: this took the UPPER middle value for an even count (10 markets), so the interval sat
      // one position off the point estimate's true median. A median averages the two middle values.
      var mid = function(a){ var k = Math.floor(a.length/2); return a.length % 2 ? a[k] : (a[k-1] + a[k]) / 2; };
      return band(mid(los), mid(his));
    };
    var o = [];
    /* n beside every number: each tile is the median of n_markets markets,
       each market's correlation on the stated range of weeks. */
    var nw = p.n_weeks || {};
    var nTxt = function(f){ var r = nw[f]; if (!r) return '';
      return ' Median of ' + p.n_markets + ' markets, ' + (r[0] === r[1] ? num(r[0]) : num(r[0]) + '\u2013' + num(r[1])) + ' weeks each.'; };
    o.push('<div class="cx-three">'
      + tile(sw, 'Fund buying against price, the same four weeks.' + nTxt('same_week_n'), med('same_week'))
      + tile(fw, 'Fund buying against the next eight weeks.' + nTxt('forward_n'), med('forward'))
      + tile(lv, 'How stretched they already are, against the next thirteen weeks.' + nTxt('level_n'), med('level'))
      + '</div>');
    o.push('<p class="cx-body">All three use the same measure of positioning, so the only thing that '
      + 'changes between them is the question. Fund flow and price move together in the four weeks '
      + 'they share: funds buy strength and sell weakness, and that is what most commentary about '
      + 'this report is really describing. Point the same record at the <em>next</em> eight '
      + 'weeks and the relationship '
      + (fw !== null && Math.abs(fw) < 0.12 ? 'is close to nothing' : 'is much weaker') + '.</p>');
    o.push('<p class="cx-body">The third number is the claim people actually make: funds are crowded '
      + 'long, so watch out below. Measured against the next thirteen weeks it comes out at '
      + (lv === null ? '-' : lv.toFixed(2)) + ', negative in ' + p.level_negative + ' of '
      + p.n_markets + ' markets and small everywhere. The intervals under each number are block '
      + 'bootstraps that keep the week-to-week overlap, so they are several times wider than a '
      + 'textbook standard error would suggest. Read them, not the point estimate.</p>');
    o.push('<p class="cx-body">So this report tells you who is exposed, not which way the market goes. '
      + 'A crowded position is a list of people who may have to trade '
      + 'whether they want to or not. Everything below is built on that, and where a reading does beat '
      + 'the base rate the test, the sample and the odds it is luck are shown with it.</p>');

    var rows = ['<thead><tr><th>Market</th><th>Same 4wk</th><th>Flow \u2192 next 4wk</th>'
      + '<th>\u2192 8wk</th><th>\u2192 13wk</th><th>Stretch \u2192 13wk</th></tr></thead><tbody>'];
    Object.keys(CX.commodities).forEach(function(key){
      var c = CX.commodities[key], cor = c.correlation;
      if (!cor) return;
      var f = cor.forward || {};
      /* A correlation with its n, and a withheld one with its reason: an em
         dash alone reads as "zero" or "broken", and hogs is neither. */
      if (c.price_withheld_reason || !(cor.same_week && cor.same_week.r !== null && cor.same_week.r !== undefined)) {
        rows.push('<tr><td>' + esc(c.label) + '</td><td colspan="5" class="cx-note">'
          + esc(c.price_withheld_reason || 'fewer than 20 weeks with both a price and a position') + '</td></tr>');
        return;
      }
      var cell = function(v, n){ return '<td>' + (v === null || v === undefined ? 'n/a' : v.toFixed(2))
        + (n ? ' <span class="cx-dim">n ' + num(n) + '</span>' : '') + '</td>'; };
      rows.push('<tr><td>' + esc(c.label) + '</td>'
        + cell(cor.same_week && cor.same_week.r, cor.same_week && cor.same_week.n)
        + cell(f['4'] && f['4'].flow_r, f['4'] && f['4'].flow_n) + cell(f['8'] && f['8'].flow_r, f['8'] && f['8'].flow_n)
        + cell(f['13'] && f['13'].flow_r, f['13'] && f['13'].flow_n)
        + cell(f['13'] && f['13'].level_r, f['13'] && f['13'].level_n) + '</tr>');
    });
    o.push('<div class="cx-tw"><table class="cx-table">' + rows.join('') + '</tbody></table></div>');
    o.push('<p class="cx-foot"><b>Same 4wk</b> is the four-week change in fund positioning against the '
      + 'price change over those same four weeks. <b>Flow</b> is that same four-week change against the '
      + 'price change over the period named, starting from the first close after the report was '
      + 'published. <b>Stretch</b> is how far positioning sits from normal now, against the next '
      + 'thirteen weeks. All measured on the roll-repaired series. <b>n</b> is the number of weeks with '
      + 'both a position and a price; report weeks delayed by a government shutdown are not used as '
      + 'starting points.</p>');
    host.innerHTML = o.join('');
  }

  function tile(v, label, ci){
    return '<div class="cx-big"><span class="cx-big-n">'
      + (v === null || v === undefined ? '-' : v.toFixed(2)) + '</span>'
      + (ci || '') + '<span class="cx-big-l">' + label + '</span></div>';
  }

  /* ── one market, loaded on demand ─────────────────────────────────────
     The panel's code lives in components/cot-market.js and is fetched the
     first time a market is opened: a card or picker tap, a link, or the panel
     coming within reach of the screen. Nothing changes for a reader who
     scrolls there; a reader who never does never downloads it. */
  var MARKET = null, MARKET_STATE = 'idle', DEEP_WANTED = false, DEEP_IO = null;
  var MARKET_API = {
    $: $, num: num, sgn: sgn, pct: pct, ord: ord, dt: dt, narrow: narrow, crowdWord: crowdWord,
    HOT: HOT, GREY: GREY,
    cx: function(){ return CX; }, key: function(){ return CX_KEY; }, h: function(){ return CX_H; },
    setH: function(v){ CX_H = v; renderDeep(); }
  };
  function renderDeep(){
    var host = $('cx-deep'); if (!host || !CX) return;
    DEEP_WANTED = true;
    if (DEEP_IO) { DEEP_IO.disconnect(); DEEP_IO = null; }
    if (MARKET) { MARKET.render(); return; }
    if (MARKET_STATE === 'loading') return;
    MARKET_STATE = 'loading';
    var s = document.createElement('script');
    s.src = '/components/cot-market.js?v=2';
    s.onload = function(){
      MARKET = (window.cotMarket && window.cotMarket(MARKET_API)) || null;
      MARKET_STATE = MARKET ? 'ready' : 'idle';
      if (MARKET) MARKET.render();
    };
    s.onerror = function(){
      MARKET_STATE = 'idle';
      host.innerHTML = '<p class="cx-dim" style="font-size:.8rem;margin:0">This panel did not load. '
        + 'Pick a market again to retry.</p>';
    };
    document.head.appendChild(s);
  }
  /* Render now if the reader asked for it or the panel is close; otherwise
     wait until it comes within a screen of view. */
  function renderDeepWhenNear(){
    if (DEEP_WANTED || MARKET) { renderDeep(); return; }
    var sec = $('cx-deep-sec');
    if (!sec || typeof IntersectionObserver !== 'function') { renderDeep(); return; }
    if (DEEP_IO) return;
    DEEP_IO = new IntersectionObserver(function(es){
      if (es.some(function(e){ return e.isIntersecting; })) renderDeep();
    }, { rootMargin: '800px 0px' });
    DEEP_IO.observe(sec);
  }

  function selectKey(key, scroll, quiet){
    if (!CX || !CX.commodities[key]) return;
    CX_KEY = key;
    try { localStorage.setItem('cot_market', key); } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('#cx-pick button'), function(b){
      b.setAttribute('aria-pressed', String(b.getAttribute('data-key') === key));
    });
    if (quiet) renderDeepWhenNear(); else renderDeep();
    if (scroll) {
      var sec = $('cx-deep-sec');
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function buildPicker(){
    var host = $('cx-pick'); if (!host) return;
    host.innerHTML = Object.keys(CX.commodities).map(function(key){
      return '<button type="button" data-key="' + esc(key) + '" aria-pressed="false">'
        + esc(CX.commodities[key].label) + '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('button'), function(b){
      b.addEventListener('click', function(){ selectKey(b.getAttribute('data-key'), false); });
    });
  }

  function render(){
    SECTIONS.forEach(function(id){ var el = $(id); if (el) el.className = 'cx on'; });
    if ($('cx-stamp')) {
      /* THE RECORD IS NOT THE SAME LENGTH FOR EVERY MARKET, and it is not the
         twenty years the copy used to claim. CFTC's annual archives start in
         2010, and two of the wheats appear later still. Saying "twenty years"
         over sixteen, or "since 2006" over a market that starts in 2014, is
         exactly the kind of claim this page exists to not make. Every window
         on the page is now read from the data. */
      var short = [];
      for (var ck in CX.commodities) {
        var cc = CX.commodities[ck];
        if (cc.first_week && CX.coverage.first_week && cc.first_week > CX.coverage.first_week) {
          short.push(esc(cc.label) + ' from ' + cc.first_week.slice(0,4));
        }
      }
      $('cx-stamp').innerHTML = 'Positions as of <b>' + dt(CX.report_date) + '</b>, published '
        + dt(CX.release_date) + '. CFTC Disaggregated Commitments of Traders, futures only, all '
        + 'contract months. The record here runs <b>' + num(CX.coverage.weeks) + ' weeks</b> back to '
        + dt(CX.coverage.first_week) + '.'
        + (short.length ? ' Shorter for ' + short.join(', ') + ', so their percentiles are ranked '
            + 'against less history than the rest.' : '');
      var w = $('cx-window');
      if (w) w.textContent = 'The record starts ' + String(CX.coverage.first_week).slice(0,4) + '.';
    }
    /* The cards, The Read and the chart read their statistics from this same
       file. Hand it over FIRST: renderVerdict() rewrites the banner sentence,
       and drawBoard() below must have the last word on it. */
    if (window.cotSetAnalysis) window.cotSetAnalysis(CX);
    buildPicker();
    drawBoard();
    renderPredictive();

    /* Open on CORN. Opening on whichever market was furthest from normal
       handed a corn farmer who searched for corn a Minneapolis spring wheat
       analysis. The outlier is worth naming, not worth defaulting to, so it
       gets a line above the picker instead. */
    var best = null, bestD = -1;
    for (var key in CX.commodities) {
      var p = CX.commodities[key].pctl.net_oi_all;
      if (p === null || p === undefined) continue;
      if (Math.abs(p - 50) > bestD) { bestD = Math.abs(p - 50); best = key; }
    }
    var remembered = null;
    try { remembered = localStorage.getItem('cot_market'); } catch (e) {}
    if (remembered && !CX.commodities[remembered]) remembered = null;
    if ($('cx-outlier')) {
      var bp = best ? CX.commodities[best].pctl.net_oi_all : null;
      /* Only worth naming when it is actually unusual. "Furthest from normal:
         Soybean Meal, middling" is a sentence about nothing. */
      if (best && bp !== null && (bp >= 75 || bp <= 25)) {
        $('cx-outlier').innerHTML = 'Furthest from normal this week: <button type="button" '
          + 'class="cx-link" data-key="' + esc(best) + '">' + esc(CX.commodities[best].label)
          + '</button>, ' + crowdWord(bp) + ' of its own record since ' + CX.commodities[best].first_week.slice(0,4) + '.';
        var ob = $('cx-outlier').querySelector('button');
        if (ob) ob.addEventListener('click', function(){ selectKey(best, false); });
      } else {
        $('cx-outlier').textContent = 'Nothing is at an extreme this week. Every market is inside the '
          + 'middle half of its own record.';
      }
    }
    selectKey(CX_KEY || remembered || (CX.commodities.corn ? 'corn' : Object.keys(CX.commodities)[0]), false, true);

    var f = CX.family;
    if (f && $('cx-family-count')) {
      /* From the data: the old static line said "around a hundred tests" and
         "five look real by chance" beside a live count of 46 and 2.3. */
      $('cx-family-count').textContent = ' This week ' + f.tests + ' tests produced a result out of '
        + f.attempted + ' attempted, so about ' + f.expected_by_chance + ' would look real by chance.';
    }
    var sx = CX.shutdown_excluded;
    if (sx && $('cx-shutdown')) {
      $('cx-shutdown').textContent = sx.rows
        ? ' That rule removes ' + num(sx.rows) + ' report weeks across ' + sx.markets + ' markets as starting '
          + 'points: weeks inside a government shutdown (2013, 2018\u201319, 2025), when CFTC published late on '
          + 'a catch-up schedule and the date each report became public is not known.'
        : '';
    }
    if (f && $('cx-family')) {
      $('cx-family').innerHTML = 'This week: <b>' + f.tests + '</b> tests produced a result, out of '
        + f.attempted + ' attempted. Chance alone would make about <b>' + f.expected_by_chance
        + '</b> of them look real. <b>' + f.raw_hits + '</b> cleared the usual threshold. <b>'
        + f.fdr_survivors + '</b> survived the correction for the whole batch. '
        + (f.fdr_survivors === 0
            ? 'Nothing clears that bar this week, which is the usual answer.'
            : 'Those are marked above.');
    }
    if ($('cx-limits')) {
      $('cx-limits').innerHTML = 'What this cannot do: it does not know your basis, your storage cost '
        + 'or your cash flow, and every percentage on this page is the futures board rather than the '
        /* READ IT FROM THE DATA, like every other window on this page. The
           comment 68 lines up already ruled that saying "twenty years" over
           sixteen is "exactly the kind of claim this page exists to not make"
           -- and then this literal survived in the limitations box, two
           paragraphs below #cx-stamp printing the true 870 weeks. */
        + 'price at your elevator. '
        /* FLOOR, not round. 870 weeks is 16.7 years; rounding gives 17, which
           overstates the record in the one box whose job is to say the record
           is short. Understate it or state it exactly -- never round it up. */
        + ((CX.coverage && CX.coverage.weeks) ? Math.floor(CX.coverage.weeks / 52) : 16)
        + ' years is not long enough to be sure about a market that has '
        + 'changed as much as this one has. CFTC revises earlier weeks, and we rebuild the whole '
        + 'history every Sunday rather than trust our own copy. This page is information, not advice, '
        + 'and nothing on it is a recommendation to buy or sell anything.';
    }
  }

  /* The card pill already carries the long-run ranking (share of open
     interest since 2010), so the second "vs 2010, share of open" line that
     used to sit under it is gone (2026-10-11). */

  function hideAll(){
    SECTIONS.forEach(function(id){ var el = $(id); if (el) el.className = 'cx'; });
    /* The cards' sentences and The Read come from this file too; when it is
       held back they are held back with it. */
    if (window.cotSetAnalysis) window.cotSetAnalysis(null);
  }
  /* 2026-09-25 audit: when the vintage guard hid these panels it logged to the console and said nothing on the
     page, while the intro above still said the result was "published below". A weekly page that loses half its
     content should say so. Shown only when the guard fires, not when the file is simply absent. */
  function holdNote(show){
    var n = $('cx-hold-note');
    if (!n && show) {
      var first = $(SECTIONS[0]);
      if (first && first.parentNode) {
        n = document.createElement('p'); n.id = 'cx-hold-note'; n.className = 'cot-page-sub'; n.setAttribute('role', 'status');
        n.textContent = 'The statistics panels are being updated for the newest report and will reappear when they are ready. The position cards above are current.';
        first.parentNode.insertBefore(n, first);
      }
    }
    if (n) n.style.display = show ? 'block' : 'none';
  }

  function load(isPoll){
    fetch('/data/cot-analysis.json?t=' + Date.now(), { cache: 'no-store' }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(j){
      if (!j || !j.commodities || !Object.keys(j.commodities).length) throw new Error('empty');
      /* VINTAGE GUARD. The cards above read cot.json; these panels read a
         different file. If the two are on different reports, one of them is
         last week's, and there is nothing on screen to tell a reader which.
         Hide rather than publish two answers. COT_LOADED is the report_date
         the cards are currently showing. */
      var shown = document.documentElement.getAttribute('data-cot-report') || null;
      if (!shown) {
        /* The cards have not answered yet. Do not publish these panels on the
           strength of a comparison that has not been made -- come back for it.
           Three tries covers a slow first fetch; after that the cards are
           failing and their own error path owns the page. */
        /* AND IF THEY NEVER ANSWER, STILL DO NOT PUBLISH.
           Until 2026-09-11 this fell THROUGH after three tries: render() then
           overwrote the cards' own "Couldn't load the latest COT data" notice,
           4.2 seconds in, with a confident undated verdict -- "5 of 11 markets
           sit in the top or bottom tenth" -- above eleven cards still reading
           "Loading...". Worse, the comparison this guard exists to make had not
           been made, so an analysis file from ANY week could publish as the
           headline with no date on it. Measured by setting cot-analysis.json to
           a June report while cot.json 404'd: the June board published as today's.
           A guard that fails open is not a guard. */
        VINTAGE_TRIES++;
        if (VINTAGE_TRIES < 3) { setTimeout(function(){ load(true); }, 1200); }
        if (!CX) hideAll();
        return;
      } else if (j.report_date) {
        /* cot.json stores "September 01, 2026"; the analysis file stores
           "2026-09-01". Parse both to a day rather than trusting Date() with
           two formats and a timezone. */
        var a = Date.parse(shown + ' 12:00:00 GMT'), b = Date.parse(j.report_date + 'T12:00:00Z');   /* same noon-GMT form the countdown uses; a non-ISO string with a bare Z is not reliable in Safari */
        /* The dates agreeing is not the same as the files agreeing. Two data
           files can carry the same report date and different positions, and
           nothing on screen would say which one was wrong. Compare the nets. */
        var nets = null;
        try { nets = JSON.parse(document.documentElement.getAttribute('data-cot-nets') || 'null'); } catch (e) {}
        var mismatch = null;
        if (nets) {
          for (var mk in nets) {
            var mine = j.commodities[mk];
            if (!mine || typeof mine.net !== 'number') continue;
            if (Math.abs(mine.net - nets[mk]) > Math.max(50, Math.abs(nets[mk]) * 0.005)) {
              mismatch = mk + ': cards ' + nets[mk] + ' vs analysis ' + mine.net;
              break;
            }
          }
        }
        if (mismatch) {
          if (window.console && console.warn) console.warn('cot: data files disagree, ' + mismatch);
          CX = null; hideAll(); holdNote(true); return;
        }
        if (isNaN(a) || isNaN(b) || Math.abs(a - b) > 86400000) {
          if (window.console && console.warn) {
            console.warn('cot: analysis file is on ' + j.report_date + ' but the cards are on '
              + shown + ' -- analysis panels hidden.');
          }
          CX = null; hideAll(); holdNote(true); return;
        }
      } else {
        /* No report_date on the analysis file: it cannot be matched to the cards, so it does not publish. */
        CX = null; hideAll(); holdNote(true); return;
      }
      holdNote(false);
      var changed = !CX || CX.report_date !== j.report_date;
      CX = j;
      if (changed) render();
    }).catch(function(){
      /* Silent. The analysis file is additive; when it is absent the page above
         it is complete on its own, and an error banner over working numbers is
         worse than no banner. */
      if (!CX) hideAll();
    });
  }

  function start(){
    load(false);
    /* The cards and these panels read two files written in one commit, so the
       moment the page's own poll sees a new report date this file is there
       too. The retries cover propagation skew between two objects. */
    document.addEventListener('cot:new-report', function(){
      [0, 4000, 12000, 30000, 60000].forEach(function(d){ setTimeout(function(){ load(true); }, d); });
    });
    if (CX_POLL) clearInterval(CX_POLL);
    CX_POLL = setInterval(function(){ load(true); }, 45000);
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') load(true);
    });
    var rt = null, lastNarrow = narrow();
    window.addEventListener('resize', function(){
      if (rt) clearTimeout(rt);
      rt = setTimeout(function(){
        if (!CX) return;
        drawBoard();
        if (narrow() !== lastNarrow) { lastNarrow = narrow(); if (MARKET) renderDeep(); }
      }, 200);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /* Clicking a summary card above opens that market down here. Delegated, so
     it cannot interfere with the card's own handler. */
  document.addEventListener('click', function(e){
    var card = e.target && e.target.closest && e.target.closest('.cot-card');
    if (card && card.getAttribute('data-key')) selectKey(card.getAttribute('data-key'), false);
  }, false);
  /* AND BY KEYBOARD. The cards carry role="button" and tabindex="0", so a screen
     reader announces eleven buttons and a keyboard user can tab to every one --
     and until 2026-09-11 Enter did nothing and Space scrolled the page instead.
     Announcing a control as a button is a promise that it can be operated. */
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var card = e.target && e.target.closest && e.target.closest('.cot-card[data-key]');
    if (!card) return;
    e.preventDefault();
    selectKey(card.getAttribute('data-key'), false);
  }, false);
})();
