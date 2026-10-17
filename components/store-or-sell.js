/* store-or-sell.js: the /store-or-sell page (2026-10-10).
 *
 * The answer first: "Hold to Jan? +5¢ posted carry, net of storage and
 * interest: −13¢ a bushel." from the nearest elevator to the reader's ZIP that
 * posts a later month for the crop, using the site's one calculation
 * (components/storesell.js holdLine / carryNet). With no ZIP, or no elevator
 * nearby posting a later month, the answer is the futures spread for the
 * storage window with the assumption said out loud: your basis stays where it
 * is today.
 *
 * Everything else is folded under it: the elevator's months, other elevators
 * nearby, the board's carry, and the arithmetic.
 *
 * The reader's storage, interest and shrink are kept in localStorage
 * (agsist_storesell, the same record as the homepage calculator and the cash
 * bids page) as strings: cost in $/bu a month, rate in % a year, shrink in %.
 * Blank boxes take the stated defaults and the page says so.
 */
(function () {
  'use strict';
  var SS = window.AgsistStoreSell, NET = window.AGSIST_BIDS_NET;
  var KEY = 'agsist_storesell', ZKEY = 'agsist_user_zip';
  var CROPS = { corn: 'corn', soybeans: 'soybeans', wheat: 'wheat' };
  var ALIAS = { soybean: 'soybeans', beans: 'soybeans', soy: 'soybeans' };
  var CROP_WORD = { corn: 'corn', soybeans: 'soybeans', wheat: 'wheat' };
  var MAX_TRY = 6;          // elevators read for their later months, nearest first
  var MAX_MORE = 6;         // read further out when none of those posts one
  var FAR_MILES = 150;      // how far out that second look goes
  var state = { zip: '', crop: 'corn', seq: 0, models: null, futures: null, noWindow: false, pick: null, farther: null, read: [] };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  /* ── the reader's costs ─────────────────────────────────────────────── */
  function readSaved() {
    var s = null;
    try { s = JSON.parse(lsGet(KEY) || 'null'); } catch (e) { s = null; }
    return (s && typeof s === 'object') ? s : {};
  }
  function boxes() { return { cost: $('sos-cost'), rate: $('sos-rate'), shrink: $('sos-shrink') }; }
  function restoreCosts() {
    var s = readSaved(), b = boxes();
    if (b.cost && s.cost != null && String(s.cost).trim() !== '' && isFinite(parseFloat(s.cost))) b.cost.value = String(Math.round(parseFloat(s.cost) * 1000) / 10);
    if (b.rate && s.rate != null && String(s.rate).trim() !== '') b.rate.value = s.rate;
    if (b.shrink && s.shrink != null && String(s.shrink).trim() !== '') b.shrink.value = s.shrink;
  }
  function inputs() {
    var b = boxes(), o = {};
    function num(el, max) {
      if (!el) return null;
      var v = String(el.value).trim(), n = v === '' ? null : parseFloat(v);
      var ok = n != null && isFinite(n) && n >= 0 && n <= max;
      el.setAttribute('aria-invalid', v !== '' && !ok ? 'true' : 'false');
      return ok ? n : null;
    }
    var c = num(b.cost, 50);
    o.cost = c == null ? null : c / 100;
    o.rate = num(b.rate, 30);
    o.shrink = num(b.shrink, 20);
    return SS.withDefaults(o);
  }
  function saveCosts() {
    var b = boxes(), c = b.cost ? String(b.cost.value).trim() : '';
    var s = readSaved();
    s.cost = c === '' || !isFinite(parseFloat(c)) ? '' : String(parseFloat(c) / 100);
    s.rate = b.rate ? String(b.rate.value).trim() : '';
    s.shrink = b.shrink ? String(b.shrink.value).trim() : '';
    lsSet(KEY, JSON.stringify(s));
  }

  /* ── where and what ─────────────────────────────────────────────────── */
  function readParams() {
    var q = {};
    try { q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) { q = {}; }
    var c = String(q.crop || '').toLowerCase();
    c = ALIAS[c] || c;
    if (CROPS[c]) state.crop = c;
    var z = String(q.zip || '').trim();
    if (!/^\d{5}$/.test(z)) z = String(lsGet(ZKEY) || '').trim();
    state.zip = /^\d{5}$/.test(z) ? z : '';
    if ($('sos-zip')) $('sos-zip').value = state.zip;
    if ($('sos-crop')) $('sos-crop').value = state.crop;
  }
  function pushUrl() {
    try {
      var u = new URL(location.href);
      if (state.zip) u.searchParams.set('zip', state.zip); else u.searchParams.delete('zip');
      u.searchParams.set('crop', state.crop);
      history.replaceState(null, '', u.pathname + u.search);
    } catch (e) {}
  }

  /* ── the elevators ─────────────────────────────────────────────────── */
  function nameOf(r) {
    var n = r.facility || 'Elevator', city = (r.town || r.city || '').replace(/,\s*[A-Z]{2}$/, '');
    if (city && n.toLowerCase().indexOf(city.toLowerCase()) < 0) n += ', ' + city;
    return n;
  }
  /* Nearest first, one row per elevator for this crop. An elevator whose
     best posted bid sits in a later period than its nearest one is read
     first: it is known to post a later month. */
  function candidates(snap, crop, skip, max) {
    var seen = {}, out = [];
    (snap && snap.bids || []).forEach(function (r) {
      if (r.crop !== crop || !r.place || seen[r.place] || (skip && skip[r.place])) return;
      seen[r.place] = 1;
      out.push(r);
    });
    var later = out.filter(function (r) { return r.bestPeriod && r.period && String(r.bestPeriod).slice(0, 7) > String(r.period).slice(0, 7); });
    var rest = out.filter(function (r) { return later.indexOf(r) < 0; });
    return later.concat(rest).slice(0, max || MAX_TRY).sort(function (a, b) { return (a.distance || 0) - (b.distance || 0); });
  }
  function hasLater(x) { return !!(x && x.model && !x.model.failed && x.model.later && x.model.later.length); }
  function readModels(cs) {
    return Promise.all(cs.map(function (r) {
      return SS.modelFor({ place: r.place, crop: state.crop, commodity: r.commodity, cropName: CROP_WORD[state.crop] })
        .then(function (m) { return { row: r, model: m }; }, function () { return { row: r, model: { failed: true } }; });
    }));
  }
  /* The nearest boards first (within the network's 75-mile hauling radius).
     When none of them posts a later month, look out to FAR_MILES and read
     the nearest few not yet read, those known to post a later month first,
     so the page can name the nearest elevator that does and how far off it
     is, or say how far out it looked. -> {list, farther, read} */
  function loadElevators(seq) {
    if (!state.zip || !NET || !SS.modelFor) return Promise.resolve({ list: [], farther: null, read: [] });
    return NET.snapshotForZip(state.zip).then(function (snap) {
      if (seq !== state.seq) return null;
      var cs = candidates(snap, state.crop);
      return readModels(cs).then(function (ms) {
        if (seq !== state.seq) return null;
        if (ms.some(hasLater) || !cs.length) return { list: ms, farther: null, read: ms };
        var skip = {};
        cs.forEach(function (r) { skip[r.place] = 1; });
        return NET.snapshotForZip(state.zip, { radiusMi: FAR_MILES }).then(function (far) {
          return readModels(candidates(far || snap, state.crop, skip, MAX_MORE));
        }).then(function (more) {
          var f = more.filter(hasLater).sort(function (a, b) { return (a.row.distance || 0) - (b.row.distance || 0); })[0] || null;
          return { list: ms, farther: f, read: ms.concat(more) };
        });
      });
    }).catch(function () { return { list: [], farther: null, read: [] }; });
  }

  /* ── the board ─────────────────────────────────────────────────────── */
  function loadFutures() {
    if (state.futuresP) return state.futuresP;
    state.futuresP = fetch('/data/prices.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return state.futuresP;
  }
  /* The storage window comes from the contracts on file (storesell.js
     carryWindow): null when fewer than two of this crop year's contracts
     still trade, e.g. corn from mid-May to mid-July. */
  /* Storage and interest count from this month once the crop is in the
     bin (storesell.js boardHold), the way the elevator mode counts from its
     spot month; the carry is still contract to contract. */
  /* WHICH WHEAT (2026-10-16 audit). The board carry for wheat was always
     Chicago SRW, while most wheat bids in the network price off KC HRW or
     Minneapolis spring wheat. The nearest wheat bids that name their class
     or contract decide: KC (KE) -> the KC HRW spread from the kcwheat-*
     contracts on file; Minneapolis (MW) -> no board number, because AGSIST
     has no Minneapolis quotes and the Chicago spread is a different wheat;
     otherwise the Chicago spread, called that. Pure; exported for the test. */
  var KC_RX = /\b(KE|KW)[FGHJKMNQUVXZ]?\d{0,2}\b|KCBT|\bKC\b|kansas city|hard red winter|\bHRW\b/i;
  var MW_RX = /\bMW[FGHJKMNQUVXZ]?\d{0,2}\b|MGEX|MIAX|minneapolis|spring|\bHRS\b|\bDNS\b|dark northern/i;
  var ZW_RX = /\bZW[FGHJKMNQUVXZ]?\d{0,2}\b|\bSRW\b|soft red|chicago/i;
  function wheatExch(rows) {
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i] || {}, t = [r.commodity, r.symbol, r.basisMonth, r.delivery].join(' ');
      if (MW_RX.test(t)) return 'MW';
      if (KC_RX.test(t)) return 'KE';
      if (ZW_RX.test(t)) return 'ZW';
    }
    return '';
  }
  /* The KC contracts under the wheat keys, so the one board rule
     (storesell.js boardHold, wheat's Dec/Mar/May window) reads them. */
  function kcQuotes(q) {
    var out = {};
    Object.keys(q || {}).forEach(function (k) {
      var m = /^kcwheat-([a-z]{3}\d{2})$/.exec(k);
      if (m) out['wheat-' + m[1]] = q[k];
    });
    return out;
  }
  function futuresModel(prices, crop, exch) {
    var q = prices && prices.quotes || {};
    var fm = null;
    if (crop !== 'wheat') fm = SS.boardHold(crop, q);
    else if (exch !== 'MW') {
      fm = SS.boardHold('wheat', exch === 'KE' ? kcQuotes(q) : q);
      if (fm) fm.wheat = exch === 'KE' ? 'KE' : 'ZW';
    }
    if (fm) fm.fetched = prices && prices.fetched || null;
    return fm;
  }
  /* The words for when the board quotes are from (2026-10-16 benchmark: it said "closes of
     2026-10-16" for quotes read at 11:01 am CT, mid-session). A quote is a close only when it was
     read after the 1:20 pm CT day close on its own date, or on a later day. Otherwise it is a
     delayed quote, said with the time it was read. No read time: the date only, never "closes". */
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ctParts(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return null;
    try {
      var o = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(function (x) { o[x.type] = x.value; });
      return { date: o.year + '-' + o.month + '-' + o.day, min: (+o.hour % 24) * 60 + (+o.minute) };
    } catch (e) { return null; }
  }
  function dayWords(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? MON3[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '';
  }
  function quoteWhen(date, fetched) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return 'latest quotes';
    var r = ctParts(fetched);
    if (!r) return 'quotes of ' + dayWords(date);
    if (r.date > date || (r.date === date && r.min >= 13 * 60 + 20)) return 'closes of ' + dayWords(date);
    var h = Math.floor(r.min / 60), mm = ('0' + r.min % 60).slice(-2);
    return 'delayed quotes read ' + ((h % 12) || 12) + ':' + mm + (h < 12 ? ' am' : ' pm') + ' CT ' + dayWords(r.date).replace(/, \d{4}$/, '') +
      ', before the close';
  }
  /* "KC HRW wheat futures" / "Chicago SRW wheat futures" / "corn futures" */
  function boardWord(fm) {
    if (fm && fm.wheat === 'KE') return 'KC HRW wheat futures';
    if (fm && fm.wheat === 'ZW') return 'Chicago SRW wheat futures';
    return CROP_WORD[state.crop] + ' futures';
  }
  function wheatNote(fm) {
    if (!fm || !fm.wheat) return '';
    return fm.wheat === 'KE' ? ' Nearby wheat bids price off Kansas City, so this is the KC HRW spread.'
      : ' This is the Chicago SRW spread' + (state.zip && state.models ? (exchNow() === 'ZW' ? ': nearby wheat bids price off Chicago.' : ': no wheat bid we read near ' + state.zip + ' names its futures.') : '.');
  }
  var MW_TEXT = 'Nearby wheat bids price off Minneapolis spring wheat futures. AGSIST has no Minneapolis quotes, so there is no board carry to show; the Chicago SRW spread is a different wheat. Your elevator\u2019s own later bids are the number to use.';
  function exchNow() {
    if (state.crop !== 'wheat' || !state.read || !state.read.length) return '';
    return wheatExch(state.read.slice().sort(function (a, b) { return (a.row.distance || 0) - (b.row.distance || 0); })
      .map(function (x) { return x.row; }));
  }
  /* "Oct '26 to Jul '27, 9 months" for the storage count. */
  function spanText(fm) {
    return fm.startLabel + ' to ' + fm.to.label + ', ' + fm.months + ' month' + (fm.months === 1 ? '' : 's');
  }

  /* ── drawing ───────────────────────────────────────────────────────── */
  function lineFor(m, p, inp) {
    return SS.holdLine({ to: SS.longMon(p.key).slice(0, 3), carry: p.carry, months: p.months, spot: m.spot.cash, kind: 'posted', inputs: inp });
  }
  /* THE BIG ANSWER IN PLAIN WORDS (2026-10-17, field audit). The shared line
     ("+36 3/4c futures carry, net of storage and interest: -61c a bushel") put
     a plus and a minus in one sentence. Here the result comes first, unsigned,
     and the two parts follow as amounts: "Storing to July loses 61c a
     bushel. The futures carry is 36 3/4c; storage and interest come to 97c." */
  function plainLine(o) {
    var n = SS.carryNet(o.spot, o.carry, o.months, o.inputs), c = Math.round(n.net * 100);
    var head = 'Storing to ' + o.to + (c === 0 ? ' about breaks even.' : (c > 0 ? ' nets ' : ' loses ') + Math.abs(c) + '\u00a2 a bushel.');
    var q = Math.round(o.carry * 400), amt = window.AG.px.move(Math.abs(o.carry * 100), { style: 'slash' });
    var what = o.kind === 'futures' ? 'futures' : 'posted';
    var carry = q === 0 ? 'The ' + what + ' price is the same then' : q > 0 ? 'The ' + what + ' carry is ' + amt : 'The later ' + what + ' price is ' + amt + ' lower';
    var costs = (n.storage || 0) + (n.interest || 0) + (n.shrink || 0);
    return head + ' ' + carry + '; storage and interest' + (o.inputs.shrink ? ' and shrink' : '') + ' come to ' + Math.round(costs * 100) + '\u00a2.';
  }
  function tone(n) { var c = Math.round(n * 100); return c > 0 ? 'sos-up' : c < 0 ? 'sos-dn' : ''; }

  function render() {
    var inp = inputs(), ans = $('sos-answer'), where = $('sos-where'), note = $('sos-note');
    var list = (state.models || []).filter(function (x) { return x.model && !x.model.failed && x.model.later && x.model.later.length; });
    var exch = exchNow();
    var fm = state.prices ? futuresModel(state.prices, state.crop, exch) : null;
    state.futures = fm;
    var top = list[0] || null;
    $('sos-costs-note').textContent = 'Using ' + SS.costNote(inp, null, null);
    /* ONE VERDICT, FROM THE FINAL INPUTS (2026-10-17). The board's answer used
       to paint first and be swapped for the elevator's 3 to 6 s later, often
       with another month and the other sign. While the elevators near the ZIP
       are still being read, the answer says so and nothing else. */
    if (state.zip && state.models === null) {
      ans.textContent = 'Working it out from the elevators near ' + state.zip + '\u2026';
      ans.className = 'sos-line sos-wait';
      where.textContent = 'Reading their own later bids. If none posts one, the answer uses the board\u2019s carry.';
      note.textContent = '';
      $('sos-table').innerHTML = '';
      drawOthers([], inp);
      drawMath(null);
      return;
    }
    if (top) {
      var m = top.model, p = null;
      if (state.pick) m.later.forEach(function (q) { if (q.key === state.pick) p = q; });
      if (!p) p = SS.pickPeriod(m, inp, null);
      var n = SS.carryNet(m.spot.cash, p.carry, p.months, inp).net;
      ans.textContent = plainLine({ to: SS.longMon(p.key), carry: p.carry, months: p.months, spot: m.spot.cash, kind: 'posted', inputs: inp });
      ans.className = 'sos-line ' + tone(n);
      where.innerHTML = 'At <b>' + esc(nameOf(top.row)) + '</b>' + (top.row.distance != null ? (top.row.distance < 1 ? ', under a mile from ' : ', ' + Math.round(top.row.distance) + ' miles from ') + esc(state.zip) : '') +
        ': its ' + esc(SS.shortMon(m.spot.start)) + ' bid is ' + esc(SS.cashQ(m.spot.cash)) + ' and its ' + esc(SS.shortMon(p.key)) + ' bid is ' + esc(SS.cashQ(p.cash)) + '.' +
        (m.posted ? (m.postedKind === 'posted' ? ' Posted ' : ' Read ') + esc(ctTime(m.posted)) + '.' : '');
      var lk = SS.lockNote('posted', n, SS.shortMon(p.key));
      note.textContent = 'Net = the later posted bid minus the nearest one, less ' + SS.costNote(inp, p.months, m.spot.cash).replace(/\.$/, '') + '. ' + (lk ? lk + ' ' : '') + 'Call the elevator before you count on a bid.';
      drawTable(m, p, inp);
      drawOthers(list.slice(1), inp);
      drawMath(m.spot.cash, p.carry, p.months, inp, SS.shortMon(m.spot.start) + ' bid', SS.shortMon(p.key) + ' bid');
    } else {
      $('sos-table').innerHTML = '';
      drawOthers([], inp);
      if (fm) {
        var nf = SS.carryNet(fm.spot, fm.carry, fm.months, inp).net;
        ans.textContent = plainLine({ to: fm.to.label, carry: fm.carry, months: fm.months, spot: fm.spot, kind: 'futures', inputs: inp });
        ans.className = 'sos-line ' + tone(nf);
        where.innerHTML = esc(state.zip ? (state.models === null ? 'Reading the elevators near ' + state.zip + '… ' : noLaterText()) : 'Enter your ZIP for your elevator’s own posted bids. Until then, this is the board. ') +
          esc('Carry from ' + fm.from.label + ' to ' + fm.to.label + ' ' + boardWord(fm) + ', ' + quoteWhen(fm.date, fm.fetched) + '.' + wheatNote(fm) + ' ') +
          esc(fm.fromToday ? 'Storage and interest from now: ' + spanText(fm) + '. A bid for delivery now is priced off ' + fm.from.label + ', so the months until then earn no carry but still cost you.'
                           : 'Storage and interest ' + spanText(fm) + '.') +
          fartherText();
        note.textContent = 'This assumes your basis stays where it is today, so the cash carry equals the futures spread. An elevator\u2019s posted carry can be more or less than the board\u2019s. ' +
          'Interest is figured on the ' + fm.from.label + ' futures price, ' + SS.cashQ(fm.spot) + '; on a lower cash price it would be a little less.' +
          (SS.lockNote('futures', nf, fm.to.label) ? ' ' + SS.lockNote('futures', nf, fm.to.label) : '');
        drawMath(fm.spot, fm.carry, fm.months, inp, fm.from.label + ' futures', fm.to.label + ' futures', spanText(fm));
      } else if (exch === 'MW' && state.prices) {
        ans.textContent = 'No board carry for Minneapolis wheat.';
        ans.className = 'sos-line';
        where.innerHTML = esc(noLaterText()) + fartherText();
        note.textContent = MW_TEXT;
        drawMath(null);
      } else {
        ans.textContent = state.zip && state.models === null ? 'Reading the elevators near ' + state.zip + '…' : state.noWindow ? noWindowText() : 'Prices did not load. Try again in a minute.';
        ans.className = 'sos-line';
        where.textContent = ''; note.textContent = '';
        drawMath(null);
      }
    }
    drawFutures(fm, inp, exch);
  }

  function drawTable(m, p, inp) {
    var h = '<p class="sos-fine" id="sos-tcap">' + esc(nameOf(state.models.filter(function (x) { return x.model === m; })[0].row)) + ': every posted ' + esc(CROP_WORD[state.crop]) + ' month this crop year. Tap a month to make it the answer.</p>' +
      '<table class="sos-t" aria-describedby="sos-tcap"><thead><tr><th scope="col">Deliver</th><th scope="col">Bid</th><th scope="col">Carry</th><th scope="col">Net/bu</th></tr></thead><tbody>' +
      '<tr><th scope="row">' + esc(SS.shortMon(m.spot.start)) + '</th><td>' + esc(SS.cashQ(m.spot.cash)) + '</td><td colspan="2">Sell now</td></tr>';
    m.later.forEach(function (q) {
      var n = SS.carryNet(m.spot.cash, q.carry, q.months, inp).net, on = q.key === p.key;
      h += '<tr' + (on ? ' class="sos-on"' : '') + '><th scope="row"><button type="button" class="sos-pick" data-k="' + esc(q.key) + '" aria-pressed="' + on + '">' + esc(SS.shortMon(q.key)) + ' <span class="sos-mo">' + q.months + ' mo</span></button></th>' +
        '<td>' + esc(SS.cashQ(q.cash)) + '</td><td>' + esc(SS.carryText(q.carry)) + '</td><td class="' + tone(n) + '">' + esc(SS.netText(n)) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (m.newCrop && m.newCrop.length) h += '<p class="sos-fine">' + esc(m.newCrop.map(SS.shortMon).join(', ')) + ' left out: that is next year’s crop, not stored grain.</p>';
    $('sos-table').innerHTML = h;
  }
  function drawOthers(list, inp) {
    var box = $('sos-others'), wrap = $('sos-others-wrap');
    if (!list.length) { wrap.hidden = true; box.innerHTML = ''; return; }
    wrap.hidden = false;
    box.innerHTML = list.map(function (x) {
      var m = x.model, p = SS.pickPeriod(m, inp, null), n = SS.carryNet(m.spot.cash, p.carry, p.months, inp).net;
      return '<li><b>' + esc(nameOf(x.row)) + '</b>' + (x.row.distance != null ? ' <span class="sos-mo">' + Math.round(x.row.distance) + ' mi</span>' : '') +
        '<br><span class="' + tone(n) + '">' + esc(lineFor(m, p, inp)) + '</span> <span class="sos-mo">' + esc(SS.shortMon(m.spot.start)) + ' ' + esc(SS.cashQ(m.spot.cash)) + ' → ' + esc(SS.shortMon(p.key)) + ' ' + esc(SS.cashQ(p.cash)) + '</span></li>';
    }).join('');
  }
  /* After "no elevator we read posts a later bid": the nearest one further
     out that does, or how far out the page looked. HTML, escaped. */
  function fartherText() {
    if (!state.zip || state.models === null) return '';
    var f = state.farther;
    if (f) {
      var inp = inputs(), p = SS.pickPeriod(f.model, inp, null);
      return ' <span class="sos-far">The nearest elevator we found that does is <b>' + esc(nameOf(f.row)) + '</b>' +
        (f.row.distance != null ? ', ' + Math.round(f.row.distance) + ' miles away' : '') + ': ' + esc(lineFor(f.model, p, inp)) + '</span>';
    }
    var ds = state.read.map(function (x) { return x.row.distance; }).filter(function (d) { return d != null && isFinite(d); });
    if (!ds.length) return '';
    return esc(' We read the boards of the ' + state.read.length + ' nearest elevator' + (state.read.length === 1 ? '' : 's') + ', out to ' + Math.round(Math.max.apply(null, ds)) + ' miles.');
  }
  function noLaterText() {
    var n = state.models ? state.models.length : 0, what = ' a later ' + CROP_WORD[state.crop] + ' bid right now, so this is the board. ';
    if (state.farther && n > 1) return 'None of the ' + n + ' elevators nearest ' + state.zip + ' posts' + what;
    if (state.farther && n === 1) return 'The elevator nearest ' + state.zip + ' does not post' + what;
    return 'No elevator we read near ' + state.zip + ' posts' + what;
  }
  function noWindowText(short) {
    return 'No board carry to show right now: fewer than two ' + CROP_WORD[state.crop] + ' contracts in this crop year still trade.' +
      (state.zip || short ? '' : ' Enter your ZIP for your elevator’s own posted bids.');
  }
  function drawFutures(fm, inp, exch) {
    var el = $('sos-futures');
    if (!fm && exch === 'MW' && state.prices) { el.textContent = MW_TEXT; return; }
    if (!fm) { el.textContent = state.noWindow ? noWindowText(true) : 'Futures prices did not load.'; return; }
    el.innerHTML = '<b>' + esc(SS.holdLine({ to: fm.to.label.slice(0, 3), carry: fm.carry, months: fm.months, spot: fm.spot, kind: 'futures', inputs: inp })) + '</b> ' +
      esc((fm.wheat ? (fm.wheat === 'KE' ? 'KC HRW ' : 'Chicago SRW spread: ') : '') + fm.from.label + ' ' + SS.cashQ(fm.spot) + ' to ' + fm.to.label + ' ' + SS.cashQ(fm.spot + fm.carry) + '; storage and interest ' + spanText(fm) + '.' + wheatNote(fm) + ' ') +
      'Futures carry assumes your basis does not change; your elevator’s posted later bids are what it actually pays. ' +
      '<a href="/' + (state.crop === 'soybeans' ? 'soybean' : state.crop) + '-futures-prices">' + esc(CROP_WORD[state.crop].replace(/^./, function (c) { return c.toUpperCase(); })) + ' futures →</a>';
  }
  function money(v) { return '$' + Math.abs(v).toFixed(4).replace(/(\.\d\d)00$/, '$1'); }
  function drawMath(spot, carry, months, inp, a, b, span) {
    var el = $('sos-math');
    if (spot == null) { el.textContent = ''; return; }
    var n = SS.carryNet(spot, carry, months, inp);
    el.textContent = [
      'Carry (' + b + ' minus ' + a + ')        ' + (carry < 0 ? '−' : '+') + money(carry),
      '− storage ' + money(inp.cost) + ' × ' + months + ' mo' + (span ? ' (' + span.replace(/, \d+ months?$/, '') + ')' : '') + '          −' + money(n.storage),
      '− interest ' + money(spot) + ' × ' + inp.rate + '% × ' + months + '/12   −' + money(n.interest),
      '− shrink ' + inp.shrink + '% × ' + money(spot + carry) + '        −' + money(n.shrink),
      '= ' + (n.net < 0 ? '−' : '+') + money(n.net) + ' a bushel, rounded to ' + SS.netText(n.net)
    ].join('\n');
  }
  function ctTime(iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    try { return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT'; }
    catch (e) { return ''; }
  }

  /* ── wiring ────────────────────────────────────────────────────────── */
  function run() {
    var seq = ++state.seq;
    state.models = state.zip ? null : [];
    state.farther = null; state.read = [];
    state.pick = null;
    pushUrl();
    loadFutures().then(function (p) { if (seq !== state.seq) return; state.prices = p;
      state.noWindow = !!(p && p.quotes) && !SS.carryWindow(state.crop, p.quotes); render(); });
    if (!state.zip) return;
    loadElevators(seq).then(function (res) {
      if (seq !== state.seq || res === null) return;
      state.models = res.list || []; state.farther = res.farther || null; state.read = res.read || [];
      render();
    }, function () {
      // a read that failed outright is an empty answer, never a "Working it out" left on screen
      if (seq !== state.seq) return;
      state.models = []; render();
    });
  }
  function init() {
    if (!SS || !$('sos-answer')) return;
    readParams();
    restoreCosts();
    var f = $('sos-form');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var z = String($('sos-zip').value).trim();
      if (z !== '' && !/^\d{5}$/.test(z)) { $('sos-zip').setAttribute('aria-invalid', 'true'); $('sos-answer').textContent = 'ZIP: five digits.'; return; }
      $('sos-zip').setAttribute('aria-invalid', 'false');
      state.zip = z; state.crop = $('sos-crop').value;
      if (z) lsSet(ZKEY, z);
      run();
    });
    $('sos-crop').addEventListener('change', function () { state.crop = this.value; run(); });
    var t = null;
    ['sos-cost', 'sos-rate', 'sos-shrink'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('input', function () { saveCosts(); clearTimeout(t); t = setTimeout(render, 250); });
    });
    $('sos-table').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.sos-pick');
      if (!b) return;
      state.pick = b.getAttribute('data-k'); render();
    });
    run();
  }
  window.AgsistStoreOrSell = { wheatExch: wheatExch, kcQuotes: kcQuotes, futuresModel: futuresModel, quoteWhen: quoteWhen };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
