/* components/arc-plc-math.js: "Show the math" on the ARC or PLC county pages
   (window.AgArcMath), and the shared counter sheet's rows (/arc-plc/sheet).

   The county page carries its short answers, key numbers and FAQ in the HTML.
   The long working (method, both price starts, the typical-farm table, each
   crop's verdicts, benchmark yields, break-even tables and FSA history) is
   built here, on open, from data/arc-plc/math/<ST>.json, which
   scripts/build_arc_plc.py writes (math_json). Every verdict and expected
   payment comes from the build as figured; this file lays them out. The
   break-even tables use the calculator's own ranges() (components/arc-plc.js),
   which mirrors the build's.

   test/arc-plc-math.test.mjs renders this file in a bare context against the
   math the build server-rendered before it moved here (fixtures cut from the
   committed pages) and against each county page's own cards and FAQ.

   Load order: components/arc-plc.js first (AgArcPlc.ranges, rangeText). */
(function (w) {
  'use strict';
  if (w.AgArcMath) return;

  /* ---------------------------------------------------------- formatting (mirrors the build's) */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c];
    });
  }
  function commas(ip) { return ip.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* rnd(v, k) as a decimal string: round to 9 places, then half away from zero at k (the build's rnd) */
  function rndStr(v, k) {
    var neg = v < 0, s = Math.abs(v).toFixed(9), dot = s.indexOf('.');
    var ip = s.slice(0, dot), fp = s.slice(dot + 1);
    var digits = (ip + fp.slice(0, k)).split(''), up = fp.charAt(k) >= '5';
    if (up) {
      var i = digits.length - 1;
      while (i >= 0) { if (digits[i] === '9') { digits[i] = '0'; i--; } else { digits[i] = String(+digits[i] + 1); break; } }
      if (i < 0) digits.unshift('1');
    }
    var all = digits.join(''), n = all.length - k;
    var out = (n > 0 ? all.slice(0, n) : '0') + (k ? '.' + all.slice(n) : '');
    out = out.replace(/^0+(?=\d)/, '');
    if (neg && /[1-9]/.test(out)) out = '-' + out;
    return out;
  }
  function rnd(v, k) { return parseFloat(rndStr(v, k)); }
  function fmt(v, k) { var s = rndStr(v, k), neg = s.charAt(0) === '-'; if (neg) s = s.slice(1); var p = s.split('.'); return (neg ? '-' : '') + commas(p[0]) + (p.length > 1 ? '.' + p[1] : ''); }
  function fixed(v, k) { var s = Number(v).toFixed(k), p = s.split('.'); return commas(p[0]) + (p.length > 1 ? '.' + p[1] : ''); }
  function cents(x) { return Math.floor(x * 100 + 0.5); }
  function usd(v, k) { return '$' + fmt(v, k == null ? 2 : k); }
  function usdC(c) { return c === 0 ? '$0' : usd(c / 100); }   /* the build's usd_pay, from cents it figured */
  var UNIT = { bu: { short: 'bu', word: 'bushel', per: '/bu' }, lb: { short: 'lb', word: 'pound', per: '/lb' } };
  function yf(cd, v, k) { return fmt(v, k == null ? 2 : k) + ' ' + UNIT[cd.u || 'bu'].short; }
  function pf(cd, v) {
    if (v == null) return '';
    if (cd.u === 'lb') return '$' + rndStr(v, 4);
    if ((cd.dp || 2) > 2) {
      var s = fmt(v, 4).replace(/0+$/, '');
      if (s.split('.')[1].length < 2) s = fmt(v, 2);
      return '$' + s;
    }
    return '$' + fmt(v, 2);
  }
  function per(cd) { return UNIT[cd.u || 'bu'].per; }
  function word(cd) { return UNIT[cd.u || 'bu'].word; }
  function sayPrice(cd, v) {
    if (cd.u === 'lb') return rndStr(v * 100, 2).replace(/0+$/, '').replace(/\.$/, '') + ' cents a pound';
    return pf(cd, v) + ' a ' + word(cd);
  }
  function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }   /* Python str.capitalize() */
  function cap1j(list) { return cap1(list.join(', ')); }

  /* ---------------------------------------------------------- words (mirror the build's) */
  var DLABEL = { all: 'All practices', irr: 'Irrigated', non: 'Non-irrigated' };
  var WORD = { plc: 'PLC', arc: 'ARC-CO' };
  var VWORD = { plc: 'Pick PLC', arc: 'Pick ARC-CO', lean_plc: 'Leans PLC', lean_arc: 'Leans ARC-CO', close: 'Close, either one', none: 'Neither expected to pay',
    withheld: 'Not enough history to say', mismatch: 'No typical-farm answer', noprice: 'No 2027 price yet', pending: "Waiting on USDA's closing 2025 price" };
  var NOCALL = { withheld: 1, mismatch: 1, noprice: 1, pending: 1 };
  var SHORT = { plc: 1, arc: 1, lean_plc: 1, lean_arc: 1, close: 1, none: 1 };
  var MAIN = ['corn', 'soybeans', 'wheat'];
  var RATIOS = [0.6, 0.7, 0.8, 0.9, 1.0];

  /* a packed verdict -> {verdict, plc, arc (cents), plc_wins, arc_wins, n, diff (cents), short, borrowed, alt_down, whole} */
  function unpack(p) {
    if (!p) return null;
    var v = { verdict: p[0], n: 0 };
    if (p[0] === 'withheld') { v.n = p[1] || 0; return v; }
    if (p.length < 3) return v;
    v.plc = p[1]; v.arc = p[2]; v.plc_wins = p[3]; v.arc_wins = p[4]; v.n = p[5]; v.diff = p[6]; v.short = p[7];
    v.borrowed = !!(p[8] & 1); v.alt_down = !!(p[8] & 2); v.under1 = !!(p[8] & 4); v.whole = p[9];
    return v;
  }
  function low1(t) { return /^(ARC|PLC)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1); }
  function vclass(v) {
    return 'ap-w-' + ({ plc: 'plc', arc: 'arc', lean_plc: 'lean-plc', lean_arc: 'lean-arc', close: 'close', none: 'neither' }[v] || 'withheld');
  }
  function verdictLine(v, g) {
    var w_ = v.verdict;
    if (w_ === 'withheld') return 'Not enough history to say: ' + v.n + ' past years with both a price and a county yield; we need ' + g.min_scen + '.';
    if (w_ === 'mismatch') return 'No typical-farm answer: FSA&rsquo;s county average PLC yield is above this benchmark yield. Run your own PLC yield.';
    if (w_ === 'noprice') return 'No 2027 price yet: there is no 2027 price outlook for this crop we can check against past years, so no call. ' +
      'Type a price in the calculator to see the dollars.';
    if (w_ === 'pending') return 'Waiting on USDA&rsquo;s closing 2025 season-average price, which sets the 2027 reference price.';
    var nums = 'expected ' + usdC(v.plc) + ' PLC vs ' + usdC(v.arc) + ' ARC-CO per base acre; PLC paid more in ' + v.plc_wins + ' of ' +
      v.n + ' past-year scenarios, ARC-CO in ' + v.arc_wins;
    if (w_ === 'none') return 'Neither expected to pay (' + nums + ').';
    if (w_ === 'close') return 'Close, either one: about ' + usd(v.diff / 100) + ' apart, too small or too uncertain to call (' + nums + ').';
    var note = (v.borrowed && w_.indexOf('lean_') === 0 ? ' Capped at Leans: this crop borrows corn&rsquo;s price swings.' : '') +
      (v.alt_down ? ' Not a clear pick: a futures-based price start gives a different call.' : '');
    if (w_.indexOf('lean_') === 0) {
      var side = w_.slice(5), other = side === 'plc' ? 'arc' : 'plc', ow = side === 'plc' ? v.arc_wins : v.plc_wins;
      var tail = ow === 0 ? WORD[other] + ' did not pay more in any of the ' + v.n + ' years, but the gap is within the normal swing' :
        'but the gap is within the normal swing, so ' + WORD[other] + ' is a defensible choice';
      return 'Leans ' + WORD[side] + ': expected about ' + usd(v.diff / 100) + ' more per base acre; ' + tail + ' (' + nums + ').' + note;
    }
    return 'Pick ' + WORD[w_] + ' (' + nums + ').' + note;
  }
  function whyText(v, cy, cd, by, py) {
    var maxPlc = Math.max(0, cy.erp - Math.max(0, cy.loan)) * py * 0.85;
    var maxArc = 0.12 * by * cy.bp * 0.85;
    return 'PLC pays on any season-average price below ' + pf(cd, cy.erp) + ', up to ' + usd(maxPlc) + ' per base acre at the ' + pf(cd, cy.loan) + ' loan rate, so it ' +
      'protects against a deep price drop. ARC-CO is capped at ' + usd(maxArc) + ' per base acre but also pays when the county&rsquo;s ' +
      'yield is short; it paid something in ' + v.short + ' of the ' + v.n + ' past-year scenarios. With prices centered at ' + pf(cd, cy.cen) + ', ' +
      'PLC is expected to pay ' + usdC(v.plc) + ' and ARC-CO ' + usdC(v.arc) + ' per base acre.';
  }
  function shortWord(v) {
    var w_ = v.verdict;
    if (w_ === 'plc' || w_ === 'arc') return WORD[w_];
    if (w_.indexOf('lean_') === 0) return 'Leans ' + WORD[w_.slice(5)];
    return { close: 'Either one', none: 'Neither pays', mismatch: 'Ask FSA', pending: 'Wait for USDA', noprice: 'No 2027 price yet', withheld: 'Not enough history' }[w_];
  }
  function shape(v) {
    var w_ = v.verdict;
    return w_ === 'plc' || w_ === 'arc' ? 'pick' : w_.indexOf('lean_') === 0 ? 'lean' : w_ === 'close' || w_ === 'none' ? 'close' : 'ask';
  }
  function entLabel(e) { return DLABEL[e.d] + (e.sub ? ', ' + e.sub : ''); }
  function defaultEntries(es) {
    var order = { non: 0, all: 0, irr: 1 };
    return es.map(function (_e, i) { return i; }).sort(function (a, b) {
      var x = order[es[a].d] - order[es[b].d];
      if (x) return x;
      var sa = es[a].sub || '', sb = es[b].sub || '';
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  }
  function verdictOf(rec, k, i, y) { var row = (rec.v[k] || [])[i]; return row ? unpack(row[y]) : null; }

  /* ---------------------------------------------------------- the blocks */
  function cropYear(g, k, y) { var c = g.c[k]; return c.y[y] || null; }

  function typicalHtml(g, rec, k, cname) {
    var es = rec.e[k] || [], LY = g.ly, OY = g.oy, cd = g.c[k], pyv = rec.py[k], why = cd.why || '';
    var lines = [], headV = null;
    defaultEntries(es).forEach(function (i) {
      var e = es[i];
      if (!e.by) return;
      var vl = verdictOf(rec, k, i, LY), vo = verdictOf(rec, k, i, OY), lab = esc(entLabel(e)), LY_, OY_;
      if (!vl) { vl = vo; vo = null; LY_ = OY; OY_ = LY; } else { LY_ = LY; OY_ = OY; }
      if (!vl) return;
      if (vl.verdict === 'mismatch') {
        lines.push('<p class="ap-small"><b>' + lab + ':</b> no typical-farm verdict. FSA&rsquo;s average PLC yield for the county (' + yf(cd, pyv, 1) + ') covers ' +
          'all practices and is above this benchmark (' + yf(cd, e.by) + '), so it does not describe a typical farm here. Run your own PLC yield below.</p>');
        return;
      }
      if (headV === null && SHORT[vl.verdict]) headV = [vl, e, LY_];
      var src = e.ds ? 'the ' + esc(g.n) + ' average for this crop and practice (the county has fewer than ' + g.min_scen + ' years)' : 'this county&rsquo;s own FSA yields';
      var note7 = ' The 2027 view uses FSA&rsquo;s 2026 benchmark; FSA posts 2027 later.';
      lines.push('<div class="ap-verdict ' + vclass(vl.verdict) + '"><p><b>' + lab + ', ' + LY_ + ': ' + verdictLine(vl, g) + '</b></p>' +
        (!NOCALL[vl.verdict] ? '<p>' + whyText(vl, cropYear(g, k, LY_), cd, e.by, pyv) + '</p>' : (why ? '<p class="ap-small">' + why + '</p>' : '')) +
        (vo ? '<p class="ap-small"><b>' + OY_ + ':</b> ' + verdictLine(vo, g) + (OY_ === '2027' ? note7 : '') + '</p>' : '') +
        '<p class="ap-small">For a typical farm: FSA&rsquo;s county average PLC yield ' + yf(cd, pyv, 1) + ' (program year ' + g.plc_py + ') and the official ' +
        yf(cd, e.by) + ' benchmark.' + (e.d === 'irr' ? ' That PLC yield is FSA&rsquo;s average over all practices, irrigated and not; an irrigated farm&rsquo;s own is often higher.' : '') +
        ' County yields from ' + src + '. Run your own numbers in the calculator below.</p></div>');
    });
    return { html: lines.join(''), head: headV };
  }

  function crossoverTable(cd, by) {
    var cy = cd.y['2026'], A = w.AgArcPlc, rows = [];
    RATIOS.forEach(function (r) {
      var py = rnd(by * r, 1);
      var runs = A.ranges({ erp: cy.erp, bp: cy.bp, loan: cy.loan, py: py, parts: [{ w: 1, by: by, y: by }], scale: cd.sc });
      var lab = Math.trunc(r * 100) + '%<br><span class="mut">' + yf(cd, py, 1) + '</span>';
      rows.push('<tr><td>' + lab + '</td><td>' + esc(Array.prototype.join.call(A.rangeText(runs, cd.sc), ' ')) + '</td></tr>');
    });
    return '<div class="ap-scroll"><table class="tbl ap-t ap-x"><thead><tr><th>PLC yield, % of your official benchmark</th>' +
      '<th>Which pays more, by season-average price</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function histTable(e, cd) {
    var h = e.h || [];
    if (!h.length) return '';
    var u = UNIT[cd.u || 'bu'].short, rows = '';
    for (var i = 0; i + 4 < h.length; i += 5) {
      var py = h[i], hb = h[i + 1], bp = h[i + 2], ay = h[i + 3], pay = h[i + 4];
      rows += '<tr><td>' + py + '</td><td class="num">' + fixed(hb, 2) + '</td><td class="num">' + (bp ? pf(cd, bp) : 'n/a') + '</td>' +
        '<td class="num">' + (ay != null ? Number(ay).toFixed(2) : 'not yet') + '</td>' +
        '<td class="num">' + (pay != null ? (pay === 0 ? 'none' : usd(pay)) : 'not yet') + '</td></tr>';
    }
    return '<h3>FSA history, ' + esc(entLabel(e).toLowerCase()) + '</h3><div class="ap-scroll"><table class="tbl ap-t"><thead><tr><th>Year</th>' +
      '<th class="num">Benchmark</th><th class="num">Price</th><th class="num">County yield</th><th class="num">ARC-CO $/ac</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div><p class="ap-small">Program year; benchmark yield in ' + u + '/acre; benchmark price $/' + u + '; actual county ' +
      'yield; ARC-CO payment rate per acre before the 85% factor. All from FSA&rsquo;s files. Older program years use older windows and prices, ' +
      'so they are history, not this year&rsquo;s benchmark.</p>';
  }

  function gfmt(v) { return String(v); }   /* the build sends each trend yield as %g prints it */

  function entryHtml(g, cd, e) {
    var cy = cd.y['2026'], br = e.by * cy.bp;
    var m = { br: br, g: 0.9 * br, max: 0.12 * br, max_base: 0.12 * br * 0.85, trig_y: 0.9 * br / cy.erp, cap_y: 0.78 * br / cy.erp };
    var ys = '';
    if (e.ys && e.ys.length === 5) {
      var parts = e.ys.map(function (v, j) {
        var y = g.win[j];
        return (e.x >> j) & 1 ? '<s>' + y + ': ' + gfmt(v) + '</s><span class="sr-only"> (dropped)</span>' : y + ': ' + gfmt(v);
      });
      ys = '<p class="ap-math">FSA trend-adjusted county yields (county yield or 80% of T-yield): ' + parts.join(' &middot; ') + ' ' +
        '(struck: high and low). Middle three average: <b>' + yf(cd, e.by) + '</b>.</p>';
    }
    return '\n  <h3>' + esc(entLabel(e)) + ': official 2026 ARC-CO benchmark</h3>\n  <div class="ap-kv">\n' +
      '    <div><span>Benchmark yield (FSA)</span><b>' + yf(cd, e.by) + '</b></div>\n' +
      '    <div><span>Benchmark price 2026</span><b>' + pf(cd, cy.bp) + '</b></div>\n' +
      '    <div><span>Benchmark revenue</span><b>' + usd(m.br) + '/ac</b></div>\n' +
      '    <div><span>Guarantee (90%)</span><b>' + usd(m.g) + '/ac</b></div>\n' +
      '    <div><span>Max payment (12%)</span><b>' + usd(m.max) + '/ac</b></div>\n' +
      '    <div><span>Max per base acre (&times;85%)</span><b>' + usd(m.max_base) + '</b></div>\n  </div>\n  ' + ys + '\n' +
      '  <p>At a season-average price equal to the 2026 effective reference price (' + pf(cd, cy.erp) + per(cd) + '), PLC pays nothing and ARC-CO pays when the\n' +
      '  county yield comes in below <b>' + yf(cd, m.trig_y, 1) + '</b>, reaching its cap below <b>' + yf(cd, m.cap_y, 1) + '</b>.</p>\n' +
      '  <h3>PLC vs ARC-CO break-even at a ' + yf(cd, e.by) + ' county yield, 2026 prices</h3>\n  ' + crossoverTable(cd, e.by) + '\n  ' + histTable(e, cd);
  }

  function summaryHtml(g, rec, cname) {
    var LY = g.ly, OY = g.oy, ks = rec.m.concat(rec.sm), nob = rec.nb;
    var groups = [], gi = {};
    ks.forEach(function (k) {
      var cd = g.c[k], cen = cd.y['2026'].cen;
      if (cen) {
        var s = cd.src || 'USDA';
        if (!(s in gi)) { gi[s] = groups.length; groups.push([s, []]); }
        groups[gi[s]][1].push(cd.lc + ' ' + pf(cd, cen));
      }
    });
    var cen = groups.map(function (x) { return esc(x[0]) + ': ' + x[1].join(', '); }).join('; ');
    var alts = [];
    ['corn', 'soybeans'].forEach(function (k) {
      var cd = g.c[k];
      if (ks.indexOf(k) < 0 || !cd || !cd.alt) return;
      var pr = (rec.al || {})[k] || [null, null], agree = '';
      if (pr[1]) agree = ' Here, the typical farm&rsquo;s answer at that start: ' + low1(VWORD[pr[1]]) +
        (pr[1] === pr[0] ? ' (the same)' : ', against ' + low1(VWORD[pr[0]]) + ' at USDA&rsquo;s start') + '.';
      alts.push(cd.alt + agree);
    });
    var c7 = ['corn', 'soybeans'].filter(function (k) { return ks.indexOf(k) >= 0 && g.c[k] && g.c[k].c7; }).map(function (k) { return g.c[k].c7; });
    var pend = ks.filter(function (k) { return g.c[k].y7 === 'pend'; }).map(function (k) { return g.c[k].lc; });
    var nop = ks.filter(function (k) { return g.c[k].y7 === 'nop'; }).map(function (k) { return g.c[k].lc; });
    var bor = ks.filter(function (k) { return g.c[k].bor; }).map(function (k) { return g.c[k].lc; });
    var plcs = ks.filter(function (k) { return rec.py[k]; }).map(function (k) { return g.c[k].lc + ' ' + yf(g.c[k], rec.py[k], 1); }).join('; ');
    var rows = [];
    ks.forEach(function (k) {
      var es = rec.e[k];
      defaultEntries(es).forEach(function (i) {
        [LY, OY].forEach(function (y) {
          var v = verdictOf(rec, k, i, y);
          if (!v) return;
          var pay = NOCALL[v.verdict] ? function () { return 'none'; } : usdC;
          rows.push('<tr><td>' + esc(g.c[k].lab) + '</td><td>' + DLABEL[es[i].d] + '</td><td>' + y + '</td><td class="num">' + pay(v.plc || 0) + '</td>' +
            '<td class="num">' + pay(v.arc || 0) + '</td><td>' + shortWord(v) + '</td></tr>');
        });
      });
    });
    return '<p><b>' + LY + '.</b> The ' + LY + ' crop is mostly harvested, so each scenario uses a normal ' + esc(cname) + ' crop (FSA&rsquo;s 2026 benchmark yield) and only the price moves.\n' +
      '  Prices start from USDA&rsquo;s projected 2026/27 season-average prices (' + cen + '). Around that price we ran each past year with a final USDA price: how far that year&rsquo;s final season-average\n' +
      '  price ended from October futures, for corn and soybeans.' + (bor.length ? ' ' + cap1j(bor) + ' have no October futures history of their own, so they borrow corn&rsquo;s October swings (wheat its own price changes, scaled to corn&rsquo;s size) and stop at Leans.' : '') + '</p>\n' +
      '  ' + (alts.length ? '<p><b>Two price starts.</b> ' + alts.join(' ') + ' Where the two disagree on which program leads, or on a clear pick, a clear pick drops to Leans.</p>' : '') + '\n' +
      '  <p><b>' + OY + '.</b> ' + (c7.length ? 'Corn and soybeans start from futures: ' + c7.join('; ') + '. Each scenario year also moves the county yield the way it moved that year. ' : '') +
      (nop.length ? cap1j(nop) + ': no ' + OY + ' price outlook we can check against past years, so no ' + OY + ' answer. ' : '') +
      (pend.length ? cap1j(pend) + ' wait on USDA&rsquo;s closing 2025 price, which sets the 2027 reference price.' : '') + '</p>\n' +
      '  <p><b>Typical farm.</b> FSA&rsquo;s county average PLC yield (' + plcs + ') and FSA&rsquo;s official benchmark. &ldquo;Lower&rdquo; and &ldquo;Higher&rdquo; mean 15% under or over the\n' +
      '  county average. Payments are per base acre and count FSA&rsquo;s 85% payment acres, before sequestration and payment limits.</p>\n' +
      '  <p><b>How we call it.</b> <b>Clear pick</b> when one program averages at least ' + g.gap + ' more per base acre, the gap is more than t times its standard error\n' +
      '  (2.26 for 10 years, 2.23 for 11), and it paid more in at least ' + g.wins + ' of the years. <b>Leans</b> when the gap is at least ' + g.lean + ' and one standard error, and it paid more in\n' +
      '  at least ' + g.wins + ' years. <b>Close</b> otherwise. When both round to $0: neither expected to pay.</p>\n' +
      '  <div class="ap-scroll"><table class="tbl ap-t"><caption class="ap-small">Average payment per base acre over the scenario years, typical farm (about the same PLC yield).</caption>\n' +
      '  <thead><tr><th scope="col">Crop</th><th scope="col">Practice</th><th scope="col">Year</th><th scope="col" class="num">PLC</th><th scope="col" class="num">ARC-CO</th><th scope="col">Answer</th></tr></thead>\n' +
      '  <tbody>' + rows.join('') + '</tbody></table></div>\n' +
      '  ' + (nob.length ? '<p class="ap-small">FSA lists a benchmark here but no enrolled base for ' + nob.map(function (k) { return g.c[k].lc; }).join(', ') + '.</p>' : '') + '\n' +
      '  <p class="ap-small"><b>Sources.</b> ' + g.srcs + '. ' + g.asof + ' <a href="/arc-plc#method">Full method and back-test</a>.</p>';
  }

  /* The whole "Show the math" body for one county: what the build used to put between the summary and the closing note. */
  function render(doc, fips) {
    var g = doc.g, rec = doc.c[fips];
    if (!rec) return null;
    var cname = rec.n, LY = g.ly, blocks = [];
    rec.o.forEach(function (k) {
      var es = rec.e[k];
      if (!es || !es.length) return;
      var cd = g.c[k], t = typicalHtml(g, rec, k, cname), hv = t.head;
      blocks.push('<h2 id="' + k + '">' + esc(cd.lab) + ' ' + (hv ? hv[2] : LY) + ' in ' + esc(cname) + ': ' + (hv ? VWORD[hv[0].verdict] : 'ARC-CO benchmark and break-even') + '</h2>');
      if (cd.hub) blocks.push('<p class="ap-small">' + cd.hub + '</p>');
      if (t.html) blocks.push(t.html);
      if (rec.py[k] && g.plc_py) blocks.push('<p>Average PLC yield on enrolled ' + cd.lc + ' base in this county: <b>' + yf(cd, rec.py[k], 1) + '</b> (FSA, program year ' + g.plc_py + '). ' +
        'Your farm&rsquo;s own is on the FSA-156EZ.</p>');
      es.forEach(function (e) {
        if (e.by == null) { blocks.push('<h3>' + esc(entLabel(e)) + '</h3><p class="ap-small">Official 2026 benchmark: not loaded here yet. Ask the county office.</p>' + histTable(e, cd)); return; }
        blocks.push(entryHtml(g, cd, e));
      });
    });
    var missing = MAIN.filter(function (k) { return !(k in rec.e); });
    var miss = missing.length ? '<p class="ap-small">Nothing from FSA here for ' + missing.join(' or ') + '. ' + g.ask + '</p>' : '';
    return summaryHtml(g, rec, cname) + '\n  ' + blocks.join('') + '\n  ' + miss;
  }

  /* ---------------------------------------------------------- the counter sheet */
  function sheetWhy(v, cd, y) {
    var w_ = v.verdict, cy = cd.y[y] || cd.y['2026'];
    var erp = ' PLC pays under ' + (cd.u === 'lb' ? sayPrice(cd, cy.erp) : pf(cd, cy.erp)) + '.';
    if (w_ === 'plc' || w_ === 'arc' || w_.indexOf('lean_') === 0) return WORD[w_.replace('lean_', '')] + ' about $' + v.whole + ' more per base acre for ' + y + '.' + erp;
    if (w_ === 'close') return (v.under1 ? 'Under $1 apart for ' + y + '.' : 'About $' + v.whole + ' apart for ' + y + '.') + erp;
    if (w_ === 'none') { var cen = cy.cen; return cen ? 'At USDA&rsquo;s ' + pf(cd, cen) + ', neither pays for ' + y + '.' : 'Neither pays for ' + y + '.'; }
    if (w_ === 'mismatch') return 'County PLC yield is above the benchmark.';
    if (w_ === 'noprice') return 'No ' + y + ' price outlook to check yet.';
    return w_ === 'withheld' ? 'Not enough history.' : 'Waits on USDA&rsquo;s closing 2025 price.';
  }
  /* -> [{lab, ly: {shape, word} | null, oy, why}] for the county's main then smaller crops */
  function sheetRows(doc, fips) {
    var g = doc.g, rec = doc.c[fips], LY = g.ly, OY = g.oy, out = [];
    if (!rec) return null;
    rec.m.concat(rec.sm).forEach(function (k) {
      var cd = g.c[k], es = rec.e[k], mi = rec.ci[k], e = es[mi];
      var differs = es.some(function (x) { return x.by && x.d !== e.d; });
      var lab = cd.lab + (differs ? ' (' + DLABEL[e.d].toLowerCase() + ')' : '');
      var v = verdictOf(rec, k, mi, LY), v7 = verdictOf(rec, k, mi, OY);
      if (!v || !v7) { out.push({ lab: esc(lab), ly: null, oy: null, why: 'No county average PLC yield from FSA.' }); return; }
      out.push({ lab: esc(lab), ly: { shape: shape(v), word: shortWord(v) }, oy: { shape: shape(v7), word: shortWord(v7) }, why: sheetWhy(v, cd, LY) });
    });
    return out;
  }

  var M = { render: render, sheetRows: sheetRows, verdictLine: verdictLine, whyText: whyText, unpack: unpack, rndStr: rndStr, pf: pf, yf: yf, usd: usd, esc: esc };
  w.AgArcMath = M;

  if (typeof document === 'undefined' || !document.querySelector) return;

  /* ---------------------------------------------------------- the page: build on open */
  var d = document, cache = {};
  function getMath(url) {
    if (!cache[url]) {
      cache[url] = fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
      cache[url].catch(function () { delete cache[url]; });
    }
    return cache[url];
  }
  function boot() {
    var det = d.querySelector('details[data-math]');
    if (!det) return;
    var box = det.querySelector('.ap-mathb'), url = det.getAttribute('data-math'), fips = det.getAttribute('data-f'), done = false;
    function fail() {
      var msg = 'The math for this county didn’t load. Check the connection.';
      if (w.AgStates) w.AgStates.error(box, { msg: msg, retry: show });
      else {
        box.removeAttribute('aria-busy');
        box.innerHTML = '<div class="st-msg" role="status"><p>' + esc(msg) + '</p><button type="button" class="st-retry">Try again</button></div>';
        box.querySelector('button').onclick = show;
      }
    }
    var hash = (location.hash || '').slice(1), jump = /^[a-z_]+$/.test(hash) && hash !== 'math' && !d.getElementById(hash) ? hash : '';
    function paint(doc) {
      var html = render(doc, fips);
      if (html == null) { box.removeAttribute('aria-busy'); box.innerHTML = '<p class="ap-small" role="status">The math for this county is not in the data file. The short answers above still hold.</p>'; return; }
      box.innerHTML = html;
      box.removeAttribute('aria-busy');
      done = true;
      if (w.AgAsOf && w.AgAsOf.refresh) try { w.AgAsOf.refresh(box); } catch (e) {}
      /* an old link to a crop's section (/arc-plc/<state>/<county>#oats): it lives in here now */
      var t = jump && d.getElementById(jump);
      if (t) { jump = ''; t.scrollIntoView(); }
    }
    function show() {
      if (done) return;
      if (w.AgStates) w.AgStates.skeleton(box, { lines: 8 }); else box.setAttribute('aria-busy', 'true');
      getMath(url).then(paint, fail);
    }
    det.addEventListener('toggle', function () { if (det.open) show(); });
    /* start the download before the tap lands, so opening does not wait on the network and nothing jumps */
    var sum = det.querySelector('summary');
    ['pointerdown', 'focus', 'mouseenter', 'touchstart'].forEach(function (ev) { sum.addEventListener(ev, function () { getMath(url).catch(function () {}); }, { passive: true, once: true }); });
    var idle = w.requestIdleCallback || function (f) { return setTimeout(f, 2500); };
    w.addEventListener('load', function () { idle(function () { getMath(url).catch(function () {}); }); });
    if (det.open || hash === 'math' || jump) { det.open = true; show(); }
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
