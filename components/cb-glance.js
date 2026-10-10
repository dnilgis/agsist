/* cb-glance.js -- the at-a-glance panels on /cash-bids.
 *
 * Every panel is its own render function into its own container, so the page
 * layout can be rebuilt around them without touching this file:
 *
 *   CBGlance.renderMoved(el, ctx)      boards whose basis moved since the last daily record
 *   CBGlance.renderFreshness(el, ctx)  how recently each nearby board posted; tap to filter
 *   CBGlance.renderGrid(el, ctx)       elevators down, delivery months across, cash in cells
 *   CBGlance.renderCarry(el, ctx)      harvest month against later months, and what holding nets
 *   CBGlance.toneFn(bids)              basis colour against the local median, for the cards
 *   CBGlance.snapshot(zip, radius)     the last good network read, for when both feeds fail
 *
 * ctx = { bids: every merged row of this search, elevators: the cards on screen,
 *         crop: 'corn'|'soybeans'|'wheat', zip, radius, snap: true when the rows
 *         ARE a saved snapshot }.
 *
 * THE RULE FOR EVERY NUMBER HERE: it is a number an elevator posted, or a
 * difference between two numbers the same elevator posted. Nothing is averaged
 * into a price and nothing is estimated. Where the data cannot answer, the panel
 * says so or stays empty. The one exception is stated on screen: the carry
 * panel's "net of storage and interest" line is the site's one store-or-sell
 * calculation (components/storesell.js holdLine), with the reader's own storage,
 * interest and shrink from /store-or-sell or its stated defaults.
 *
 * The page's own helpers (delKey, basisCents, groupElevators, the basis history
 * loader) are handed in by CBGlance.init() so that one rule governs both the
 * cards and these panels.
 */
(function () {
  'use strict';
  var A = null;                       /* the page's helpers, from init() */
  var FRESH_FILTER = null;            /* 'hour' | 'today' | 'older' | 'unread' | 'notime' | null */
  var GRID_ALL = false, CARRY_ALL = false, MOVED_ALL = false;
  var SS_KEY = 'agsist_storesell';    /* the reader's storage, interest, shrink: shared with /store-or-sell */
  var LAST = null;                    /* last ctx, for re-renders from inside a panel */
  var SNAP_KEY = 'agsist_cb_snapshot';
  /* A snapshot older than this is not offered at all. It is dated either way;
     past a week it is history, not a floor under today's decision. */
  var SNAP_MAX_AGE_MS = 7 * 24 * 3600e3;
  /* Within this many cents of the area median a basis is coloured neutral. */
  var TONE_BAND_CENTS = 2;
  /* A median of two is just the pair; three boards before "area" means anything. */
  var TONE_MIN_BOARDS = 3;
  var GRID_FIRST = 12, CARRY_FIRST = 8, MOVED_FIRST = 6;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CROP_WORD = { corn: 'corn', soybeans: 'soybeans', wheat: 'wheat' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function minus(n) { return n < 0 ? '−' : '+'; }
  /* Cents, to a tenth only when the board quoted one (4.5225 - 4.40 = 12.25c). */
  function centsTxt(c) {
    var r = Math.round(Math.abs(c) * 100) / 100;
    var s = (r % 1 === 0) ? r.toFixed(0) : String(r).replace(/0+$/, '');
    return s + '¢';
  }
  function signedCents(c) { return (c === 0 ? '' : minus(c)) + centsTxt(c); }
  function money(p) { return '$' + p.toFixed(2); }
  function shortMonth(k) {                      /* '2026-10' -> 'Oct 26' */
    if (k === 'spot') return 'Spot';
    var p = k.split('-'); return MON[+p[1] - 1] + ' ' + p[0].slice(2);
  }
  function localYmd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function nameOf(e) {
    var t = A.townOf(e);
    var n = e.facility || '';
    /* "Heartland Co-op Cambridge", not "Heartland Co-op — Cambridge, IA" -- the
       strip has one line per board and the state is the reader's own. */
    return t && n.toLowerCase().indexOf(t.toLowerCase()) < 0 ? n + ' ' + t : n;
  }
  function monthsBetween(a, b) {                /* keys, 'spot' = this month */
    var f = function (k) { if (k === 'spot') k = A.monthFloorKey(); var p = k.split('-'); return (+p[0]) * 12 + (+p[1] - 1); };
    return f(b) - f(a);
  }

  /* ── WHICH COLUMN A ROW BELONGS IN ─────────────────────────────────────
     A month key from the page's own delKey(), or 'spot' where the feed or the
     board says spot and names no month. A season ("Fall 26") or a month pair
     names no one month and is left out of the grid -- and counted, so the
     panel can say how many were left out rather than lose them. */
  function colOf(b) {
    var k = A.delKey(b);
    if (k) {
      if (A.bidPeriodPast(b)) return null;
      return k;
    }
    var p = String(b.deliveryPeriod || '');
    if (p === 'spot') return 'spot';
    if (!p && /\b(spot|cash|immediate)\b/i.test(String(b.deliveryMonth || '')) && A.isSpotDelivery(b.deliveryMonth, b)) return 'spot';
    return '';
  }
  /* A row this page will put a price on in a comparison: per bushel, inside
     its crop's price band, a plain grade, and a basis that is neither unusual
     nor of unclear unit. The same gate the best-bid cards use. */
  function comparable(b, crop) {
    if (!b || b.category !== crop || b.cashPrice == null) return false;
    if (A.notPerBushel(b) || !A.plausible(b) || A.isSpecialGrade(b)) return false;
    if (A.basisUnusual(b) || A.basisUnclear(b)) return false;
    return true;
  }

  /* elevator key -> { elev, cells: {col: bid}, skipped: n } for one crop. */
  function buildMatrix(bids, crop) {
    var rows = (bids || []).filter(function (b) { return comparable(b, crop); });
    var elevs = A.groupElevators(rows);
    var cols = {}, out = [], skipped = 0;
    elevs.forEach(function (e) {
      var cells = {};
      (e.commodities[crop] || []).forEach(function (b) {
        var c = colOf(b);
        if (c === null) return;
        if (c === '') { skipped++; return; }
        /* Two rows in one month at one elevator: the higher cash, the same
           tie-break deliverySort() uses for the card's nearest bid. */
        if (!cells[c] || A.ppu(b.cashPrice) > A.ppu(cells[c].cashPrice)) cells[c] = b;
      });
      var ks = Object.keys(cells);
      if (!ks.length) return;
      ks.forEach(function (k) { cols[k] = 1; });
      out.push({ elev: e, cells: cells });
    });
    var colList = Object.keys(cols).sort(function (a, b) {
      if (a === 'spot') return -1; if (b === 'spot') return 1; return a < b ? -1 : a > b ? 1 : 0;
    });
    out.sort(function (a, b) { return (a.elev.distance == null ? 1e9 : a.elev.distance) - (b.elev.distance == null ? 1e9 : b.elev.distance); });
    return { rows: out, cols: colList, skipped: skipped };
  }

  /* ════════════════════ 2. THE DELIVERY GRID ════════════════════════════ */
  function renderGrid(el, ctx) {
    if (!el) return;
    var crop = ctx.crop, m = buildMatrix(ctx.bids, crop);
    if (!m.rows.length || !m.cols.length) {
      el.innerHTML = '<div class="cbg-h">Delivery grid · ' + esc(CROP_WORD[crop] || crop) + '</div>' +
        '<p class="cbg-none">No ' + esc(CROP_WORD[crop] || crop) + ' bids nearby name a delivery month.</p>';
      return;
    }
    var shown = GRID_ALL ? m.rows : m.rows.slice(0, GRID_FIRST);
    /* Best among the rows ON SCREEN: a shaded cell must be one the reader can see beat the others. */
    var best = {};
    m.cols.forEach(function (c) {
      var hi = null, n = 0;
      shown.forEach(function (r) { var b = r.cells[c]; if (!b) return; n++; var p = A.ppu(b.cashPrice); if (hi == null || p > hi) hi = p; });
      best[c] = n >= 2 ? hi : null;           /* one bid in a column beats nobody */
    });
    var h = '<div class="cbg-h">Delivery grid · ' + esc(CROP_WORD[crop] || crop) + ' cash, $/bu</div>';
    h += '<p class="cbg-sub">Each cell is the elevator’s own posted cash for that delivery month. Blank = not posted. <span class="cbg-best-key">Shaded</span> = best in the column among the elevators listed.</p>';
    h += '<div class="cbg-grid-wrap" tabindex="0" role="region" aria-label="Cash bids by delivery month"><table class="cbg-grid"><thead><tr><th scope="col" class="cbg-gn">Elevator</th>';
    m.cols.forEach(function (c) { h += '<th scope="col">' + esc(shortMonth(c)) + '</th>'; });
    h += '</tr></thead><tbody>';
    shown.forEach(function (r) {
      var e = r.elev;
      h += '<tr><th scope="row" class="cbg-gn"><span class="cbg-gname">' + esc(nameOf(e)) + '</span>' +
        '<span class="cbg-gsub">' + (e.distance != null ? Math.round(e.distance) + ' mi' : '') +
        (e.unread ? ' · <span class="cbg-warn">not reached</span>' : '') + '</span></th>';
      m.cols.forEach(function (c) {
        var b = r.cells[c];
        if (!b) { h += '<td class="cbg-blank"><span class="cbg-sr">not posted</span></td>'; return; }
        var p = A.ppu(b.cashPrice), isBest = best[c] != null && Math.abs(p - best[c]) < 1e-9;
        var bc = A.basisCents(b.basis, b);
        var title = (b.deliveryMonth ? 'Board says: ' + b.deliveryMonth : '') + (bc != null ? ' · basis ' + signedCents(bc) : '');
        h += '<td class="' + (isBest ? 'cbg-best' : '') + '" title="' + esc(title) + '">' + money(p) + (isBest ? '<span class="cbg-sr"> best in column</span>' : '') + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    var foot = [];
    if (m.rows.length > GRID_FIRST) foot.push('<button type="button" class="cbg-link" data-cbg="grid-all">' + (GRID_ALL ? 'Show the nearest ' + GRID_FIRST : 'Show all ' + m.rows.length + ' elevators') + '</button>');
    if (m.skipped) foot.push(m.skipped + ' ' + (m.skipped === 1 ? 'bid names' : 'bids name') + ' a season or a range of months rather than one month, and ' + (m.skipped === 1 ? 'is' : 'are') + ' on the cards below, not in this grid.');
    if (foot.length) h += '<p class="cbg-foot">' + foot.join(' ') + '</p>';
    el.innerHTML = h;
  }

  /* ════════════════════ 3. THE CARRY VIEW ═══════════════════════════════ */
  function renderCarry(el, ctx) {
    if (!el) return;
    var crop = ctx.crop, m = buildMatrix(ctx.bids, crop);
    var hy = A.harvestYear(), harvestEnd = hy + '-12';
    var lines = [];
    m.rows.forEach(function (r) {
      var ks = Object.keys(r.cells).sort(function (a, b) { if (a === 'spot') return -1; if (b === 'spot') return 1; return a < b ? -1 : 1; });
      if (ks.length < 2) return;
      var near = ks[0];
      /* "Harvest" is spot or a month no later than this harvest's December. */
      if (near !== 'spot' && near > harvestEnd) return;
      var np = A.ppu(r.cells[near].cashPrice), bestK = null, bestP = null;
      /* Stored grain only: a month in next year's crop (September on for corn
         and soybeans, June on for wheat) is a new-crop sale, not storage, and
         is not paired with this year's harvest bid (storesell.js newCropFrom). */
      var SSc = window.AgsistStoreSell, cut = SSc ? SSc.newCropFrom(near === 'spot' ? A.monthFloorKey() : near, crop) : '';
      ks.slice(1).forEach(function (k) { if (cut && k >= cut) return; var p = A.ppu(r.cells[k].cashPrice); if (bestP == null || p > bestP) { bestP = p; bestK = k; } });
      if (bestK == null) return;
      lines.push({ elev: r.elev, near: near, np: np, far: bestK, fp: bestP, gain: Math.round((bestP - np) * 10000) / 100, months: monthsBetween(near, bestK) });
    });
    var h = '<div class="cbg-h">Carry · ' + esc(CROP_WORD[crop] || crop) + ': harvest delivery against later months this crop year</div>';
    if (!lines.length) {
      el.innerHTML = h + '<p class="cbg-none">No elevator nearby posts both a harvest month and a later month this crop year for ' + esc(CROP_WORD[crop] || crop) + '.</p>';
      return;
    }
    lines.sort(function (a, b) { return b.gain - a.gain; });
    var SS = window.AgsistStoreSell, inputs = SS ? SS.withDefaults(readCosts()) : null;
    var store = inputs ? Math.round(inputs.cost * 1000) / 10 : '';
    h += '<p class="cbg-sub">The elevator’s own two posted prices; the best later month is shown. ' +
      (inputs ? 'Net is the site’s one store-or-sell figure: ' + esc(SS.costNote(inputs, null, null)) + ' ' : '') +
      '<label class="cbg-stor">Your storage cost <input type="number" inputmode="decimal" min="0" max="50" step="0.5" id="cbg-stor" placeholder="3.5" value="' + (inputs && inputs.assumed.indexOf('cost') < 0 ? store : '') + '"> ¢/bu a month</label> ' +
      '<a href="/store-or-sell?crop=' + esc(crop) + '">Change interest and shrink →</a></p>';
    h += '<ul class="cbg-carry">';
    (CARRY_ALL ? lines : lines.slice(0, CARRY_FIRST)).forEach(function (l) {
      var nm = shortMonth(l.near), fm = shortMonth(l.far);
      var say = l.gain > 0 ? fm + ' pays ' + centsTxt(l.gain) + ' over ' + nm
              : l.gain === 0 ? fm + ' pays the same as ' + nm
              : 'No later month pays more: ' + fm + ' is ' + centsTxt(l.gain) + ' under ' + nm;
      var net = '';
      if (inputs && l.gain > 0 && l.months > 0) {
        var n = SS.carryNet(l.np, l.gain / 100, l.months, inputs).net, nc = Math.round(n * 100);
        net = '<span class="cbg-net ' + (nc > 0 ? 'cbg-up' : nc < 0 ? 'cbg-dn' : '') + '">' +
          esc(SS.holdLine({ to: fm, carry: l.gain / 100, months: l.months, spot: l.np, kind: 'posted', inputs: inputs })) + '</span>';
      }
      h += '<li><span class="cbg-cname">' + esc(nameOf(l.elev)) + (l.elev.unread ? ' <span class="cbg-warn">(not reached)</span>' : '') + '</span>' +
        '<span class="cbg-csay ' + (l.gain > 0 ? 'cbg-up' : l.gain < 0 ? 'cbg-dn' : '') + '">' + esc(say) + '</span>' +
        '<span class="cbg-cnum">' + esc(nm) + ' ' + money(l.np) + ' → ' + esc(fm) + ' ' + money(l.fp) + '</span>' + net + '</li>';
    });
    h += '</ul>';
    if (lines.length > CARRY_FIRST) h += '<p class="cbg-foot"><button type="button" class="cbg-link" data-cbg="carry-all">' + (CARRY_ALL ? 'Show the top ' + CARRY_FIRST : 'Show all ' + lines.length) + '</button></p>';
    el.innerHTML = h;
    var inp = el.querySelector('#cbg-stor');
    if (inp) inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      writeCost((isFinite(v) && v >= 0 && inp.value.trim() !== '') ? String(Math.min(v, 50) / 100) : '');
      renderCarry(el, ctx);
      var again = el.querySelector('#cbg-stor'); if (again) again.focus();
    });
  }
  /* The same localStorage record /store-or-sell and the homepage calculator
     keep ({cost: '$/bu a month', rate: '%', shrink: '%'}, strings). */
  function readCosts() {
    var s = null, o = {};
    try { s = JSON.parse(window.localStorage.getItem(SS_KEY) || 'null'); } catch (e) { s = null; }
    if (s && typeof s === 'object') ['cost', 'rate', 'shrink'].forEach(function (k) {
      var v = parseFloat(s[k]); if (String(s[k] == null ? '' : s[k]).trim() !== '' && isFinite(v) && v >= 0) o[k] = v;
    });
    return o;
  }
  function writeCost(v) {
    var s = null;
    try { s = JSON.parse(window.localStorage.getItem(SS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    s.cost = v;
    try { window.localStorage.setItem(SS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  /* ════════════════════ 4. THE FRESHNESS SCOREBOARD ═════════════════════
     Buckets each card's elevator by the newest posted time on its rows (the
     page's own asOfT). A board the network could not read this run is "not
     reached" whatever its time says. A row with no posted time -- the licensed
     feed sends none -- is counted as such, never guessed into a bucket. */
  function freshOf(e, now) {
    if (e.unread) return 'unread';
    if (e.asOfT == null) return 'notime';
    if (now - e.asOfT < 3600e3) return 'hour';
    if (localYmd(new Date(e.asOfT)) === localYmd(new Date(now))) return 'today';
    return 'older';
  }
  var FRESH_LABEL = { hour: 'Posted in the last hour', today: 'Earlier today', older: 'Before today', unread: 'Not reached', notime: 'No time posted' };
  function renderFreshness(el, ctx) {
    if (!el) return;
    var now = Date.now(), n = { hour: 0, today: 0, older: 0, unread: 0, notime: 0 };
    (ctx.elevators || []).forEach(function (e) { n[freshOf(e, now)]++; });
    var total = (ctx.elevators || []).length;
    if (!total) { el.innerHTML = ''; return; }
    var h = '<div class="cbg-h">How fresh are these boards?</div><div class="cbg-fresh" role="group" aria-label="Filter the elevator cards by when the board posted">';
    ['hour', 'today', 'older', 'unread', 'notime'].forEach(function (k) {
      if (k === 'notime' && !n[k]) return;
      var on = FRESH_FILTER === k;
      h += '<button type="button" class="cbg-fb cbg-f-' + k + (on ? ' on' : '') + '" data-cbg-fresh="' + k + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (n[k] ? '' : ' disabled') + '><b>' + n[k] + '</b><span>' + FRESH_LABEL[k] + '</span></button>';
    });
    h += '</div>';
    if (FRESH_FILTER) {
      h += '<p class="cbg-foot">Cards below show only <b>' + esc(FRESH_LABEL[FRESH_FILTER].toLowerCase()) + '</b> (' + n[FRESH_FILTER] + ' of ' + total + '). <button type="button" class="cbg-link" data-cbg-fresh="' + FRESH_FILTER + '">Show all</button></p>';
    }
    el.innerHTML = h;
  }
  /* The page asks this for the pool of cards it pages through. */
  function cardPool(elevators) {
    if (!FRESH_FILTER) return elevators;
    var now = Date.now();
    return elevators.filter(function (e) { return freshOf(e, now) === FRESH_FILTER; });
  }

  /* ════════════════════ 1. MOVED TODAY ══════════════════════════════════
     The only honest "before" this page holds is the daily basis record the
     page already loads (data/basis/<ST>.json): for each row, the basis now,
     the one before it, the day it changed and the last day it was seen.
       - changed ON today's record          -> moved today, from `prev`
       - on the record unchanged, last seen today or the previous weekday,
         and the board now shows another number -> moved since that day
     Anything else (a row first seen today, a row last seen a week ago, a row
     the record never saw) is not on this strip. Cash has no stored "before"
     anywhere, so only basis is reported. */
  function prevWeekday(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() - 1);
    return x;
  }
  function moveOf(b, e, today, prevDay) {
    var h = A.bhLook(b, e); if (!h) return null;
    var live = A.basisCents(b.basis, b); if (live == null) return null;
    live = Math.round(live);
    if (!A.bhSane(live) || !A.bhSane(h.cur)) return null;
    var before = null, when = null;
    if (h.since && h.since >= today && h.prev != null && A.bhSane(h.prev)) {
      before = h.prev; when = 'today';
    } else if (h.last && (h.last >= today || h.last === prevDay.ymd) && (!h.since || h.since < today)) {
      before = h.cur; when = h.last >= today ? 'today' : prevDay.word;
    }
    if (before == null || live === before) return null;
    return { d: live - before, from: before, to: live, when: when };
  }
  function renderMoved(el, ctx) {
    if (!el) return;
    if (ctx.snap) { el.innerHTML = ''; return; }
    var now = new Date(), today = localYmd(now), pw = prevWeekday(now);
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    var prevDay = { ymd: localYmd(pw), word: localYmd(pw) === localYmd(y) ? 'since yesterday' : 'since ' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][pw.getDay()] };
    var rows = (ctx.bids || []).filter(function (b) { return (b.category === 'corn' || b.category === 'soybeans' || b.category === 'wheat') && !A.notPerBushel(b) && A.plausible(b) && !A.basisUnusual(b); });
    var elevs = A.groupElevators(rows), sts = {};
    elevs.forEach(function (e) { var s = String(e.state || '').trim().toUpperCase(); if (s) sts[s] = 1; });
    var token = {}; el._cbgToken = token;
    el.innerHTML = '';
    Promise.all(Object.keys(sts).map(A.bhLoadState)).then(function () {
      if (el._cbgToken !== token) return;
      var items = [];
      elevs.forEach(function (e) {
        ['corn', 'soybeans', 'wheat'].forEach(function (crop) {
          var mv = [];
          (e.commodities[crop] || []).forEach(function (b) {
            if (!b.symbol || !b.deliveryMonth) return;
            var k = colOf(b); if (k === null) return;
            var m = moveOf(b, e, today, prevDay); if (m) { m.col = k; m.b = b; mv.push(m); }
          });
          if (!mv.length) return;
          mv.sort(function (a, b) { return (a.col || 'z') < (b.col || 'z') ? -1 : 1; });
          var first = mv[0], same = mv.every(function (x) { return x.d === first.d; });
          items.push({ e: e, crop: crop, mv: mv, first: first, same: same });
        });
      });
      if (!items.length) {
        el.innerHTML = '<div class="cbg-h">Basis moves since yesterday</div><p class="cbg-none">No nearby board on the daily basis record shows a basis move since yesterday. ' +
          'Boards AGSIST reads directly from the elevator cannot be matched to that record yet, so they are not checked here.</p>';
        return;
      }
      items.sort(function (a, b) { return (a.e.distance == null ? 1e9 : a.e.distance) - (b.e.distance == null ? 1e9 : b.e.distance); });
      var h = '<div class="cbg-h">Basis moves since yesterday</div><ul class="cbg-moved">';
      (MOVED_ALL ? items : items.slice(0, MOVED_FIRST)).forEach(function (it) {
        var f = it.first, up = f.d > 0;
        var mon = f.col ? shortMonth(f.col) : String(f.b.deliveryMonth);
        var more = it.mv.length > 1 ? (it.same ? ' (and ' + (it.mv.length - 1) + ' more month' + (it.mv.length > 2 ? 's' : '') + ', same move)' : ' (' + (it.mv.length - 1) + ' other month' + (it.mv.length > 2 ? 's' : '') + ' moved too)') : '';
        h += '<li><span class="cbg-mv ' + (up ? 'cbg-up' : 'cbg-dn') + '" aria-hidden="true">' + (up ? '▲' : '▼') + '</span> ' +
          '<b>' + esc(nameOf(it.e)) + '</b> ' + esc(it.crop) + ' ' + esc(mon) + ' basis <b class="' + (up ? 'cbg-up' : 'cbg-dn') + '">' + signedCents(f.d) + '</b> ' + esc(f.when) +
          ' <span class="cbg-mut">(' + signedCents(f.from) + ' → ' + signedCents(f.to) + ')' + esc(more) + (it.e.distance != null ? ' · ' + Math.round(it.e.distance) + ' mi' : '') + '</span></li>';
      });
      h += '</ul>';
      if (items.length > MOVED_FIRST) h += '<p class="cbg-foot"><button type="button" class="cbg-link" data-cbg="moved-all">' + (MOVED_ALL ? 'Show fewer' : 'Show all ' + items.length) + '</button></p>';
      h += '<p class="cbg-foot cbg-mut">From AGSIST’s daily basis record. A rising basis is a stronger price for the seller.</p>';
      el.innerHTML = h;
    });
  }

  /* ════════════════════ 6. BASIS COLOUR THAT MEANS SOMETHING ════════════
     Red for every negative basis tells a reader nothing: nearly every basis in
     the Corn Belt is negative. The colour says instead whether this board is
     better or worse than the other boards in THIS search for the same crop and
     the same delivery month -- against the median of one basis per elevator.
     Fewer than three elevators in that month and there is no "area" to beat, so
     the cell is neutral. Returns a class name, or null to leave the cell alone. */
  function toneFn(bids) {
    var groups = {};
    (bids || []).forEach(function (b) {
      if (!b || b.basis == null || A.notPerBushel(b) || !A.plausible(b) || A.isSpecialGrade(b) || A.basisUnusual(b) || A.basisUnclear(b)) return;
      var k = colOf(b); if (!k) return;
      var c = A.basisCents(b.basis, b); if (c == null) return;
      var g = b.category + '|' + k, ek = (b.facility || '') + '|' + (b.branch || '') + '|' + (b.city || '');
      groups[g] = groups[g] || {};
      if (groups[g][ek] == null || c > groups[g][ek]) groups[g][ek] = c;   /* one per elevator */
    });
    var med = {};
    Object.keys(groups).forEach(function (g) {
      var v = Object.keys(groups[g]).map(function (k) { return groups[g][k]; }).sort(function (a, b) { return a - b; });
      if (v.length < TONE_MIN_BOARDS) return;
      var mid = Math.floor(v.length / 2);
      med[g] = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    });
    return function (b) {
      if (!b || b.basis == null) return null;
      if (A.notPerBushel(b) || A.basisUnclear(b) || A.basisUnusual(b)) return null;
      var c = A.basisCents(b.basis, b); if (c == null) return null;
      var k = colOf(b), m = (k && !A.isSpecialGrade(b) && A.plausible(b)) ? med[b.category + '|' + k] : null;
      if (m == null) return 'flat bz-none';
      var d = c - m;
      return Math.abs(d) <= TONE_BAND_CENTS ? 'flat bz-mid' : d > 0 ? 'bz-up' : 'bz-dn';
    };
  }

  /* ════════════════════ 8. THE SNAPSHOT FLOOR ═══════════════════════════
     Saved on this phone after every search that drew network rows, and only
     the network's rows: the bids the AGSIST network read from the elevators'
     own boards. Offered only when the live search came back with nothing AND
     an error, it is dated to the minute, and every row is marked as not
     reached so each card says "call before you load". */
  var SNAP_FIELDS = ['facility', 'branch', 'city', 'town', 'state', 'distance', 'phone', 'commodity', 'cashPrice', 'basis', 'deliveryMonth', 'deliveryStart', 'symbol', 'basisMonth', 'asOf', 'category', 'deliveryPeriod', 'sourceStatus', 'periodPast', 'via'];
  function saveSnapshot(ctx) {
    if (ctx.snap) return;
    var rows = (ctx.bids || []).filter(function (b) { return b.via === 'direct' && !b.stale; });
    if (!rows.length || !ctx.zip) return;
    var slim = rows.map(function (b) { var o = {}; SNAP_FIELDS.forEach(function (f) { if (b[f] != null && b[f] !== '') o[f] = b[f]; }); return o; });
    try { localStorage.setItem(SNAP_KEY, JSON.stringify({ zip: String(ctx.zip), radius: ctx.radius, savedAt: Date.now(), rows: slim })); } catch (e) {}
  }
  function snapshot(zip, radius) {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch (e) { return null; }
    if (!s || String(s.zip) !== String(zip) || !Array.isArray(s.rows) || !s.rows.length) return null;
    var age = Date.now() - (+s.savedAt || 0);
    if (!(age >= 0 && age <= SNAP_MAX_AGE_MS)) return null;
    var r = radius || s.radius;
    var rows = s.rows.filter(function (b) { return b.distance == null || b.distance <= r; }).map(function (b) {
      var o = {}; for (var k in b) o[k] = b[k];
      o.stale = true; o.snap = true; o.via = 'direct'; o.phone = o.phone || '';
      if (o.deliveryStart == null) o.deliveryStart = '';
      return o;
    });
    if (!rows.length) return null;
    var d = new Date(+s.savedAt);
    var t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var day = localYmd(d) === localYmd(new Date()) ? 'today' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return {
      rows: rows, savedAt: +s.savedAt,
      note: 'Live bids did not load. Showing the snapshot from ' + t + ' ' + day + ', the last AGSIST network bids this phone loaded for ZIP ' + s.zip +
            (s.radius ? ' (' + s.radius + ' mi)' : '') + '. Call to confirm before you haul.'
    };
  }

  /* ════════════════════ THE HOOK ════════════════════════════════════════ */
  function ensureSlots(root) {
    if (root.querySelector('.cbg-slot')) return;
    root.innerHTML =
      '<section class="cbg-slot cbg-moved-slot" data-slot="moved" aria-label="Basis moves since yesterday"></section>' +
      '<section class="cbg-slot" data-slot="fresh" aria-label="Board freshness"></section>' +
      '<section class="cbg-slot" data-slot="grid" aria-label="Delivery grid"></section>' +
      '<section class="cbg-slot" data-slot="carry" aria-label="Carry"></section>';
  }
  function slot(root, k) { return root.querySelector('[data-slot="' + k + '"]'); }
  function update(ctx) {
    LAST = ctx;
    var root = document.getElementById('cb-glance');
    if (!A || !root) return;
    if (!ctx || !ctx.bids || !ctx.bids.length) { clear(); return; }
    ensureSlots(root);
    root.style.display = '';
    root.classList.toggle('cbg-snap', !!ctx.snap);
    try { renderMoved(slot(root, 'moved'), ctx); } catch (e) { slot(root, 'moved').innerHTML = ''; }
    try { renderFreshness(slot(root, 'fresh'), ctx); } catch (e) { slot(root, 'fresh').innerHTML = ''; }
    try { renderGrid(slot(root, 'grid'), ctx); } catch (e) { slot(root, 'grid').innerHTML = ''; }
    try { renderCarry(slot(root, 'carry'), ctx); } catch (e) { slot(root, 'carry').innerHTML = ''; }
    saveSnapshot(ctx);
  }
  function clear() {
    var root = document.getElementById('cb-glance');
    if (root) { root.innerHTML = ''; root.style.display = 'none'; }
  }
  function onClick(e) {
    var t = e.target.closest('[data-cbg],[data-cbg-fresh]');
    if (!t || !LAST) return;
    var root = document.getElementById('cb-glance');
    var f = t.getAttribute('data-cbg-fresh');
    if (f) {
      FRESH_FILTER = FRESH_FILTER === f ? null : f;
      /* The page re-pages its cards from cardPool() and calls update() again. */
      if (A.rerender) A.rerender(); else renderFreshness(slot(root, 'fresh'), LAST);
      return;
    }
    var w = t.getAttribute('data-cbg');
    if (w === 'grid-all') { GRID_ALL = !GRID_ALL; renderGrid(slot(root, 'grid'), LAST); }
    if (w === 'carry-all') { CARRY_ALL = !CARRY_ALL; renderCarry(slot(root, 'carry'), LAST); }
    if (w === 'moved-all') { MOVED_ALL = !MOVED_ALL; renderMoved(slot(root, 'moved'), LAST); }
  }
  function init(api) {
    A = api;
    var root = document.getElementById('cb-glance');
    if (root && !root._cbg) { root._cbg = 1; root.addEventListener('click', onClick); }
  }
  /* A new search starts with no freshness filter: a filter the reader set for
     one ZIP must not silently hide most of the next one. */
  function newSearch() { FRESH_FILTER = null; GRID_ALL = CARRY_ALL = MOVED_ALL = false; }

  window.CBGlance = {
    init: init, update: update, clear: clear, newSearch: newSearch,
    renderMoved: renderMoved, renderFreshness: renderFreshness, renderGrid: renderGrid, renderCarry: renderCarry,
    toneFn: toneFn, cardPool: cardPool, snapshot: snapshot,
    TONE_BAND_CENTS: TONE_BAND_CENTS
  };
})();
