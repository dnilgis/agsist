/* components/arc-plc-simple.js: the ARC or PLC short-answer pages
   (scripts/build_arc_plc.py writes them with every answer already in the HTML).

   - Lower / About the same / Higher: shows the answer the build figured for a
     PLC yield 15% under, at, or 15% over the county average. The page carries
     About the same; Lower and Higher ride on each card as the build's verdict,
     gap and flags (data-lower, data-higher; lv_pack in the build), and
     AgArcCard.level writes them with the build's own words (level_html).
     Nothing is figured here. test/arc-plc-cards.test.mjs holds the words to the
     build's on every card.
   - State and county pickers go to that county's page. A county or state
     page carries only its own state and county in the lists; the rest come
     from data/arc-plc/nav.json after the page loads (or on first touch).
   - Use my location: asks the phone only when the button is tapped, then finds
     the county right here (point in polygon against the county shapes in
     data/arc-plc/geo/<ST>.json, cut by the build from the Farmland Atlas file).
     The location is never sent anywhere.
   - "Run every number for your farm" opens when the link asks for the
     calculator, or when this device has numbers saved for this county.
   - "Your check" (#your-check): crop, base acres and PLC yield in, the 2025
     and 2026 dollars out (AgArcPay, mirrors pay_figure in the build). The
     build writes the first crop at 100 base acres; nothing is stored or sent.
     "Print my estimate" prints the page's own sheet (#estimate, print CSS):
     what was typed and the four figures before and after the 5.7% cut.
   - The crop switcher (.ap-tabs) shows one crop card at a time.

   window.AgArcFind (inRing, locate) is the math alone, for test/arc-plc.test.mjs.
   Mirrors in_ring and locate in scripts/build_arc_plc.py. */
(function (w, d) {
  'use strict';
  if (w.AgArcFind) return;

  function inRing(x, y, r) {
    var inside = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inBox(b, x, y) { return !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }
  /* states whose bounding box holds the point */
  function candidates(nav, lon, lat) {
    return Object.keys(nav.s).filter(function (k) { return inBox(nav.s[k].b, lon, lat); });
  }
  /* geos: {ST: geo file}; -> {st, rec} or null. rec: [fips, name, slug or null, bbox, polygons] */
  function locate(nav, geos, lon, lat) {
    var sts = candidates(nav, lon, lat);
    for (var a = 0; a < sts.length; a++) {
      var g = geos[sts[a]];
      if (!g) continue;
      for (var i = 0; i < g.c.length; i++) {
        var rec = g.c[i];
        if (!inBox(rec[3], lon, lat)) continue;
        for (var p = 0; p < rec[4].length; p++) {
          var n = 0, poly = rec[4][p];
          for (var q = 0; q < poly.length; q++) if (inRing(lon, lat, poly[q])) n++;
          if (n % 2 === 1) return { st: sts[a], rec: rec };
        }
      }
    }
    return null;
  }
  w.AgArcFind = { inRing: inRing, candidates: candidates, locate: locate };
  /* ---------------------------------------------------------- one card's answer (mirrors level_html, gap_line,
     big_word, short_word, year_line, tier_html and erp_line in scripts/build_arc_plc.py) */
  var WORD = { plc: 'PLC', arc: 'ARC-CO' };
  var TIER = { pick: 'Clear pick', lean: 'Leans', close: 'Close', ask: 'No answer yet' };
  var RS = '&rsquo;';
  var BOR_WHY = ['Expected payments are not printed for this crop: it does not have enough of its own price history.', 'Expected payments are not printed for this crop: it does not have enough of its own price history.'];
  var CAP_LINE = 'Too little price history for a clear pick: shown as Leans.';
  var IRR_NOTE = 'Figured with the county' + RS + 's all-practice PLC yield; an irrigated farm' + RS + 's own is often higher.';
  function unpackLv(p) {
    var a = String(p).split(',');
    return { w: a[0], whole: +a[1], f: +a[2], n: +a[3], w7: a[4], wo: a[5] || '' };
  }
  function shapeOf(w) { return w === 'plc' || w === 'arc' ? 'pick' : w.indexOf('lean_') === 0 ? 'lean' : w === 'close' || w === 'none' ? 'close' : 'ask'; }
  function bigWord(w) {
    if (w === 'plc' || w === 'arc') return WORD[w];
    if (w.indexOf('lean_') === 0) return WORD[w.slice(5)];
    return { close: 'Either one', none: 'Neither expected to pay' }[w] || 'No answer yet';
  }
  function shortWord(w) {
    if (w === 'plc' || w === 'arc') return WORD[w];
    if (w.indexOf('lean_') === 0) return 'Leans ' + WORD[w.slice(5)];
    return { close: 'Either one', none: 'Neither pays', mismatch: 'Depends on your PLC yield', pending: 'Wait for USDA', noprice: 'No 2027 price yet', withheld: 'Not enough history' }[w];
  }
  function low1(t) { return /^(ARC|PLC)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1); }
  function tier(w) { var s = shapeOf(w); return '<span class="ap-tier ap-tier-' + s + '"><svg class="ap-ic" viewBox="0 0 16 16" aria-hidden="true"><use href="#api-' + s + '"/></svg>' + TIER[s] + '</span>'; }
  function gapLine(v, c) {
    var w = v.w, lc = c.lc, y = c.ly, pl = /s$/.test(lc);
    /* no expected dollars (flag 64): the reason for this crop (flag 128: too few years of its own prices), and
       "held at Leans" only where the borrowed swings lowered a clear pick (flag 512); gap_line in the build script */
    if ((v.f & 64) && (w === 'plc' || w === 'arc' || w === 'close' || w.indexOf('lean_') === 0)) {
      var bw = c.bw || BOR_WHY[v.f & 128 ? 1 : 0];
      if (w === 'close') return 'Too close to call. ' + bw;
      var bs = w.indexOf('lean_') === 0 ? w.slice(5) : w, bo = bs === 'plc' ? 'arc' : 'plc';
      var bt = WORD[bs] + ' leads across the ' + v.n + ' price years we ran, but that swings from year to year.';
      if (v.f & 32) bt += ' ' + WORD[bo] + ' did not come out ahead in any of them.';
      bt += ' ' + bw;
      if (v.f & 512) bt += ' ' + CAP_LINE;
      if (v.f & 2) bt += ' A futures-based price start gives a different answer, so it stops at Leans.';
      return bt;
    }
    if (w === 'plc' || w === 'arc') return WORD[w] + ' comes out about $' + v.whole + ' more per base acre.';
    if (w.indexOf('lean_') === 0) {
      var side = w.slice(5), other = side === 'plc' ? 'arc' : 'plc';
      var t = WORD[side] + ' comes out about $' + v.whole + ' more per base acre, but that swings from year to year.';
      if (v.f & 32) t += ' ' + WORD[other] + ' did not come out ahead in any of the ' + v.n + ' price years we ran.';
      if (v.f & 512) t += ' ' + CAP_LINE;
      if (v.f & 2) t += ' A futures-based price start gives a different answer, so it stops at Leans.';
      return t;
    }
    if (w === 'close') {
      if (v.f & 4) return 'They come out less than $1 apart per base acre.';
      if (v.f & 8) return 'They come out about $' + v.whole + ' apart per base acre. Too small to matter.';
      return WORD[v.f & 16 ? 'plc' : 'arc'] + ' comes out about $' + v.whole + ' more per base acre, but it swings more than that from year to year.';
    }
    if (w === 'none') return 'Neither one is likely to pay on ' + lc + ' for ' + y + ' at USDA' + RS + 's price outlook' + (c.cen ? ' (' + c.cen + ')' : '') + '.';
    if (w === 'noprice') return 'There is no ' + y + ' price outlook for ' + lc + ' we can check against past years, so no ' + y + ' answer yet.';
    if (w === 'pending') return 'Waiting on USDA' + RS + 's closing 2025 price, which sets the 2027 reference price.';
    return 'Not enough years of price and county yield history to call it.';
  }
  function yearLine(w, y, rs) {
    var t = { mismatch: rs || 'depends on your PLC yield', pending: 'waiting on USDA' + RS + 's closing 2025 price', noprice: 'no ' + y + ' price yet',
      withheld: 'not enough history to say', none: 'neither expected to pay', close: 'close, either one' }[w];
    return '<b>' + y + ':</b> ' + (t || low1(shortWord(w)));
  }
  /* c: {lc, cen, pu, oth, irr, ly, oy, rng}; p: the packed answer; sameW: the card's About-the-same verdict.
     rng (data-rng, rng_words in the build): a PLC yield over the benchmark has no one typical farm, so the
     build ran PLC yields of 60% to 100% of it; ly [big word, tier verdict, answer, benchmark], oy and ot the
     few words for the other year and the other practice. Never "Ask FSA" (arcfix, Oct 20, 2026). */
  function level(c, p, sameW) {
    var v = unpackLv(p), w = v.w, R = c.rng || {}, ly = R.ly || ['Depends on your PLC yield', 'mismatch', '', ''];
    var big = bigWord(w), tw = w, g = gapLine(v, c);
    if (w === 'mismatch') {
      /* ly: [big word, tier verdict, the answer, the benchmark as printed ('' when the reason does not apply)] */
      /* flag 256: the PLC yield is under 60% of the benchmark (mm_why in the build); when the card's About the
         same answer is a mismatch too, it is on the same side, so one flag serves both sentences */
      var lo = v.f & 256;
      big = ly[0]; tw = ly[1];
      /* under 60% with one call across the range (ly[1] is a call): that call is not the same at the PLC yield itself (mm_why held) */
      var held = lo && ly[1] !== 'mismatch';
      g = !ly[3] ? ly[2] : sameW === 'mismatch' ? ly[2] + ' The county average PLC yield is ' + (lo ? 'under 60% of' : 'above') + ' this ' + ly[3] + ' benchmark' +
        (held ? ', and the call there is not the same' : '') + ', so there is no one typical farm here.' :
        (lo ? 'A PLC yield that low is under 60% of the ' : 'A PLC yield that high is above the ') + ly[3] + ' benchmark' + (held ? ', and the call there is not the same' : '') + '. ' + ly[2];
    }
    var oth = '';
    if (c.oth && v.wo) oth = '<p class="ap-oth"><b>' + c.oth + ' ground:</b> ' + (v.wo !== 'mismatch' ? low1(shortWord(v.wo)) : (R.ot || 'depends on your PLC yield')) + '.' + (c.oth === 'Irrigated' ? ' ' + IRR_NOTE : '') + '</p>';
    if (c.irr) oth = '<p class="ap-oth">' + IRR_NOTE + '</p>' + oth;
    var erp = w === 'mismatch' ? '' : '<p>PLC only pays if ' + c.lc + ' ' + (/s$/.test(c.lc) ? 'average' : 'averages') + ' under ' + c.pu + ' for ' + c.ly + '.</p>';
    return '<div class="ap-ans"><span class="ap-big">' + big + '</span>' + tier(tw) + '</div><p>' + g + '</p>' + erp + oth + '<p class="ap-y2">' + yearLine(v.w7, c.oy, R.oy) + '</p>';
  }
  /* a card element -> what level() needs (the attributes the build writes) */
  function cardOf(art, seg) {
    var lv = art.querySelector('.ap-lv'), rng = null;
    try { rng = JSON.parse(art.getAttribute('data-rng') || 'null'); } catch (e) {}
    return { rng: rng, lc: art.getAttribute('data-lc'), bw: art.getAttribute('data-bw') || '', cen: art.getAttribute('data-cen') || '', pu: art.getAttribute('data-pu'),
      oth: art.getAttribute('data-oth') || '', irr: /^irr(:|$)/.test(lv.getAttribute('data-e') || ''),
      ly: seg.getAttribute('data-ly'), oy: seg.getAttribute('data-oy') };
  }
  w.AgArcCard = { level: level, unpack: unpackLv };

  /* ---------------------------------------------------------- "Your check" (Nov 20, 2026; mirrors pay_figure, calc_note
     and chk_money in scripts/build_arc_plc.py, same order of operations, so both round alike). x: one crop of the
     section's data-pay; b: base acres; py: PLC yield. Nothing is stored or sent. */
  function rnd2(v) {   /* the build's rnd(v, 2): round to 9 places, then half up to the cent */
    var t = Math.round(v * 1e9) / 1e9;
    return Math.floor(t * 100 + 0.5 + 1e-7) / 100;
  }
  function figure(x, b, py) {
    function f(v) { return v == null ? null : rnd2(v); }
    return { a25: x.r25a != null ? f(x.r25a * 0.85 * b) : null, p25: x.r25 != null ? f(x.r25 * py * 0.85 * b) : null,
      a26: x.a26u != null ? f(x.a26u * b) : null, p26: x.f26 != null ? f(x.f26 * py * b) : null };
  }
  function money(v) {
    var c = Math.round(rnd2(v) * 100), s = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + s + '.' + ('0' + (c % 100)).slice(-2);
  }
  function note(r) {
    if (r.p25 == null) return '2025: no figure for this crop here. 2026: only the program the farm is enrolled in pays.';
    var hi = Math.max(r.p25, r.a25 != null ? r.a25 : 0);
    return '2025: the farm gets the higher one, ' + money(hi) + ', or ' + money(hi * (1 - 0.057)) + ' after the 5.7% sequestration cut. ' +
      '2026: only the program the farm is enrolled in pays.';
  }
  /* "Print my estimate" (Nov 20, 2026; mirrors est_sheet in the build): the sheet's cells for crop x at b base acres and
     PLC yield py, each figure before and after the 5.7% cut, or the crop's reason where the page prints no figure */
  function sheet(x, b, py) {
    var r = figure(x, b, py), wy = { a25: x.w25 || x.w25a || '', p25: x.w25 || '', a26: x.w || '', p26: x.w || '' }, out = {};
    ['a25', 'p25', 'a26', 'p26'].forEach(function (n) {
      out[n] = r[n] != null ? money(r[n]) : wy[n];
      out[n + 's'] = r[n] != null ? money(r[n] * (1 - 0.057)) : wy[n];
    });
    return out;
  }
  w.AgArcPay = { figure: figure, money: money, note: note, rnd2: rnd2, sheet: sheet };

  if (!d || !d.querySelector) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getJSON(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }


  function levels() {
    var seg = d.querySelector('.ap-seg');
    if (!seg) return;
    var keep = [];   /* each card's About-the-same answer as the build wrote it */
    seg.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-lv]');
      if (!b) return;
      var lv = b.getAttribute('data-lv'), bs = seg.querySelectorAll('button'), arts = d.querySelectorAll('.ap-crop[data-lower]'), i;
      for (i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i] === b ? 'true' : 'false');
      for (i = 0; i < arts.length; i++) {
        var box = arts[i].querySelector('.ap-lv');
        if (!box) continue;
        if (keep[i] == null) keep[i] = box.innerHTML;
        if (lv === 'same') { box.innerHTML = keep[i]; box.setAttribute('data-lv', 'same'); continue; }
        var raw = arts[i].getAttribute('data-' + lv);
        if (!raw) continue;
        var sameW = (box.getAttribute('data-p') || '').split(',')[0];
        box.innerHTML = level(cardOf(arts[i], seg), raw.split(';')[2], sameW);
        box.setAttribute('data-lv', lv);
      }
      var note = d.querySelector('.ap-seg-note');
      if (note && note.getAttribute('data-' + lv)) note.textContent = note.getAttribute('data-' + lv);
    });
  }

  /* the five terms (Nov 20, 2026; GLOSS in the build marks each where it first shows): its note on hover, tap or focus */
  var GLOSS = {
    base: 'Base acres: the acres FSA assigns a farm for each crop, listed on its FSA-156EZ. ARC and PLC pay on 85% of them, whatever is planted.',
    py: 'PLC yield: the farm' + RS + 's yield FSA pays PLC on, also on the FSA-156EZ. This page uses the county average until you type your own.',
    seq: 'Sequestration: an across-the-board cut to federal farm payments, set each fiscal year. 5.7% is the rate reported for these payments.',
    mya: 'Season-average price (MYA, marketing year average): USDA' + RS + 's national average of what farmers were paid for the crop over its marketing year.',
    erp: 'Effective reference price: the price PLC is measured against, set by law each year: the statutory reference price, or 88% of recent ' +
      'season-average prices if higher, up to 115% of the statutory price.'
  };
  w.AgArcGloss = GLOSS;
  function glossary() {
    var gs = d.querySelectorAll('.ap-g[data-g]');
    for (var i = 0; i < gs.length; i++) {
      var t = GLOSS[gs[i].getAttribute('data-g')];
      if (!t || gs[i].querySelector('.ap-gt')) continue;
      gs[i].setAttribute('tabindex', '0');
      gs[i].insertAdjacentHTML('beforeend', '<span class="ap-gt" role="tooltip">' + t + '</span>');
    }
  }

  /* the crop switcher (Nov 20, 2026): one card at a time; the build opens the first, so nothing moves on load.
     A link to #corn or #crop-corn (the crop pages link that way) opens that crop's card. */
  function tabs() {
    var bar = d.querySelector('.ap-tabs');
    if (!bar) return;
    function pick(k, go) {
      var card = d.getElementById('crop-' + k);
      if (!card) return false;
      var bs = bar.querySelectorAll('button[data-k]'), cs = d.querySelectorAll('.ap-crop'), i;
      for (i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-k') === k ? 'true' : 'false');
      for (i = 0; i < cs.length; i++) cs[i].hidden = cs[i] !== card;
      if (go && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
      return true;
    }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-k]');
      if (b) pick(b.getAttribute('data-k'), false);
    });
    var h = (location.hash || '').replace(/^#(crop-)?/, '');
    if (/^[a-z_]+$/.test(h)) pick(h, true);
  }

  function finder() {
    var root = d.querySelector('[data-arcfind]');
    if (!root) return;
    var st = d.getElementById('af-st'), co = d.getElementById('af-co'), msg = d.getElementById('af-msg'), loc = d.getElementById('af-loc');
    var NAV = null, GEO = {};
    /* one download: the idle fill asks for the states and the counties at once, so the promise is kept,
       not just the answer (2026-10-16: nav.json, 123 KB, was fetched twice on every county page) */
    var navP = null;
    function nav() {
      if (NAV) return Promise.resolve(NAV);
      if (!navP) {
        navP = getJSON(root.getAttribute('data-nav')).then(function (j) { NAV = j; return j; });
        navP.catch(function () { navP = null; });
      }
      return navP;
    }
    function geo(s) { return GEO[s] ? Promise.resolve(GEO[s]) : getJSON(root.getAttribute('data-geo') + s + '.json').then(function (j) { GEO[s] = j; return j; }); }
    function say(html) { msg.innerHTML = html || ''; msg.classList.toggle('is-on', !!html); }
    function hub(s) { var x = NAV && NAV.s[s]; return x && x.slug ? ' <a href="/arc-plc/' + x.slug + '">Every ' + esc(x.n) + ' county</a>.' : ''; }
    function go(s, slug, label) {
      var x = NAV.s[s];
      say('Going to ' + esc(label) + '.');
      w.location.href = '/arc-plc/' + x.slug + '/' + slug;
    }
    /* the page carries only its own county; the state's full list comes from nav.json once the page
       has loaded, or the moment the list is touched, whichever is first */
    function fillCounties() {
      if (!co.hasAttribute('data-fill') || !st.value) return;
      var want = st.value;
      nav().then(function (N) {
        if (st.value !== want || !co.hasAttribute('data-fill') || !N.s[want]) return;
        var keep = co.value;
        co.innerHTML = '<option value="">Pick a county</option>' + N.s[want].c.map(function (c) {
          return '<option value="' + esc(c[0]) + '" data-s="' + esc(c[2]) + '"' + (c[0] === keep ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('');
        co.removeAttribute('data-fill');
      }).catch(function () {});
    }
    function fillStates() {
      if (!st.hasAttribute('data-fill')) return;
      nav().then(function (N) {
        if (!st.hasAttribute('data-fill')) return;
        var keep = st.value, ks = Object.keys(N.s).sort(function (a, b) { return N.s[a].n < N.s[b].n ? -1 : N.s[a].n > N.s[b].n ? 1 : 0; });
        st.innerHTML = '<option value="">Pick a state</option>' + ks.map(function (k) {
          return '<option value="' + esc(k) + '"' + (k === keep ? ' selected' : '') + '>' + esc(N.s[k].n) + '</option>'; }).join('');
        st.removeAttribute('data-fill');
      }).catch(function () {});
    }
    function fillBoth() { fillStates(); fillCounties(); }
    if (co.hasAttribute('data-fill') || st.hasAttribute('data-fill')) {
      ['pointerdown', 'focus', 'touchstart', 'keydown'].forEach(function (ev) {
        co.addEventListener(ev, fillCounties, { passive: true });
        st.addEventListener(ev, fillStates, { passive: true });
      });
      var idle = w.requestIdleCallback || function (f) { return setTimeout(f, 2000); };
      if (d.readyState === 'complete') idle(fillBoth); else w.addEventListener('load', function () { idle(fillBoth); });
    }
    st.addEventListener('change', function () {
      co.removeAttribute('data-fill');
      say('');
      if (!st.value) { co.innerHTML = '<option value="">Pick a state first</option>'; co.disabled = true; return; }
      co.disabled = true; co.innerHTML = '<option value="">Loading counties</option>';
      var want = st.value;
      nav().then(function (N) {
        if (st.value !== want) return;
        var x = N.s[want];
        co.innerHTML = '<option value="">Pick a county</option>' + x.c.map(function (c) {
          return '<option value="' + esc(c[0]) + '" data-s="' + esc(c[2]) + '">' + esc(c[1]) + '</option>'; }).join('');
        co.disabled = false;
      }).catch(function () {
        co.innerHTML = '<option value="">Counties did not load</option>';
        say('The county list did not load. Check the connection and pick the state again.');
      });
    });
    co.addEventListener('change', function () {
      var o = co.options[co.selectedIndex];
      if (!co.value || !o) return;
      var slug = o.getAttribute('data-s');
      var go2 = function (N) { var x = N.s[st.value]; if (x && slug) { say('Going to ' + esc(o.text) + '.'); w.location.href = '/arc-plc/' + x.slug + '/' + slug; } };
      nav().then(go2).catch(function () { say('That county page did not load. Check the connection and try again.'); });
    });
    if (!loc) return;
    loc.addEventListener('click', function () {
      if (!navigator.geolocation) { say('This browser cannot share a location. Pick your state and county above.'); return; }
      loc.disabled = true;
      say('Finding your county. Your location stays on this phone.');
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        nav().then(function (N) {
          var sts = candidates(N, lon, lat);
          if (!sts.length) return null;
          return Promise.all(sts.map(function (s) { return geo(s).catch(function () { return null; }); })).then(function () { return locate(N, GEO, lon, lat); });
        }).then(function (hit) {
          loc.disabled = false;
          if (!hit) { say('That spot is outside the US counties FSA lists. Pick your state and county above.'); return; }
          var rec = hit.rec, x = NAV.s[hit.st], nm = rec[1] + ', ' + (x ? x.n : hit.st);
          if (rec[2] && x && x.slug) { go(hit.st, rec[2], nm); return; }
          say('You look to be in ' + esc(nm) + '. FSA&rsquo;s 2026 file has no ARC-CO benchmark there, so there is no county page.' + hub(hit.st));
        }).catch(function () {
          loc.disabled = false;
          say('The county map did not load, so we could not find your county. Pick your state and county above.');
        });
      }, function (err) {
        loc.disabled = false;
        say(err && err.code === 1 ? 'Location is off for this site, so we could not find your county. Pick your state and county above, or turn location on and tap again.' :
          err && err.code === 3 ? 'Your phone did not give a location in time. Tap again, or pick your state and county above.' :
            'Your phone could not find a location. Pick your state and county above.');
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
    });
  }

  function runOpen() {
    var run = d.getElementById('run');
    if (!run) return;
    var want = /[?&](py|by|p|base|year|crop)=/.test(location.search) || location.hash === '#run' || location.hash === '#calculator';
    if (!want) {
      var calc = run.querySelector('[data-fips]'), f = calc && calc.getAttribute('data-fips');
      try {
        for (var i = 0; f && i < localStorage.length; i++) { var k = localStorage.key(i); if (/^ap3:[fy]:/.test(k) && k.indexOf('|' + f) > 0) { want = true; break; } }
      } catch (e) {}
    }
    /* the full calculator sits in the fold at the bottom (Nov 20, 2026): opening it opens the fold too */
    var fold = run.parentElement && run.parentElement.closest ? run.parentElement.closest('details') : null;
    function open() { run.open = true; if (fold) fold.open = true; }
    if (want) open();
    /* "Depends on your PLC yield: run it below" links to #run: open it when the link is followed */
    d.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href="#run"]'); if (a) open(); });
  }

  /* crop pages (/arc-plc/<crop>): each state's county links, filled from data/arc-plc/hub/<crop>.json when its list opens */
  function hubs() {
    var dets = d.querySelectorAll('details[data-hub]'), J = {};
    function load(u) { if (!J[u]) { J[u] = getJSON(u); J[u].catch(function () { delete J[u]; }); } return J[u]; }
    Array.prototype.forEach.call(dets, function (det) {
      var box = det.querySelector('.ap-hubl'), u = det.getAttribute('data-hub'), done = false;
      function show() {
        if (done) return;
        if (w.AgStates) w.AgStates.skeleton(box, 2);
        load(u).then(function (j) {
          var sl = det.getAttribute('data-slug'), k = det.getAttribute('data-k'), cs = (j.s || {})[det.getAttribute('data-st')] || [];
          box.innerHTML = cs.map(function (c) { return '<a href="/arc-plc/' + esc(sl) + '/' + esc(c[0]) + '#' + esc(k) + '">' + esc(c[1]) + '</a>'; }).join(' &middot; ');
          box.removeAttribute('aria-busy');
          done = true;
        }).catch(function () {
          if (w.AgStates) w.AgStates.error(box, { msg: 'The county list didn’t load.', retry: show, inline: true });
          else { box.removeAttribute('aria-busy'); box.textContent = 'The county list did not load. Close and open it to try again.'; }
        });
      }
      det.addEventListener('toggle', function () { if (det.open) show(); });
      det.querySelector('summary').addEventListener('pointerdown', function () { load(u).catch(function () {}); }, { passive: true, once: true });
    });
  }

  /* "Your check": crop, base acres and PLC yield in, the four dollar figures out (AgArcPay above). The build writes the
     first crop at 100 base acres into the HTML, so the box keeps its size when this runs. */
  function payCalc() {
    var box = d.getElementById('your-check');
    if (!box) return;
    var X;
    try { X = JSON.parse(box.getAttribute('data-pay') || '{}'); } catch (e) { return; }
    function q(n) { return box.querySelector('[data-pc="' + n + '"]'); }
    var sel = q('k'), bIn = q('b'), yIn = q('y');
    function num(el) { var v = parseFloat(String(el.value).replace(/,/g, '')); return isFinite(v) && v >= 0 ? v : null; }
    function show() {
      var x = X[sel.value];
      if (!x) return;
      var b = num(bIn), py = num(yIn);
      if (b == null || py == null) { q('note').textContent = 'Type base acres and a PLC yield, as numbers.'; return; }
      var r = figure(x, b, py);
      q('a25').textContent = r.a25 != null ? money(r.a25) : (x.w25 || x.w25a || '');
      q('p25').textContent = r.p25 != null ? money(r.p25) : (x.w25 || '');
      q('a26').textContent = r.a26 != null ? money(r.a26) : (x.w || '');
      q('p26').textContent = r.p26 != null ? money(r.p26) : (x.w || '');
      q('note').textContent = note(r);
      fillSheet(x, b, py);
    }
    /* the print sheet (#estimate, est_sheet in the build) says what the calculator says, with what was typed */
    function fillSheet(x, b, py) {
      var sh = d.getElementById('estimate');
      if (!sh) return;
      var c = sheet(x, b, py), row = function (lab, y, s) {
        return '<tr><th scope="row">' + lab + '</th><td data-es="a' + y + s + '">' + esc(c['a' + y + s]) + '</td><td data-es="p' + y + s + '">' + esc(c['p' + y + s]) + '</td></tr>';
      };
      sh.innerHTML = '<p class="ap-est-k">AGSIST ARC/PLC payment estimate</p><h2>' + esc(sh.getAttribute('data-c')) + '</h2>' +
        '<p>Crop: <b data-es="n">' + esc(x.n) + '</b> &middot; Base acres: <b data-es="b">' + esc(bIn.value) + '</b> &middot; PLC yield: <b data-es="y">' + esc(yIn.value) +
        '</b> ' + (x.u === 'lb' ? 'lb' : 'bu') + ' (as entered)</p>' +
        '<table class="ap-chk"><thead><tr><th scope="col">Crop year</th><th scope="col">ARC-CO</th><th scope="col">PLC</th></tr></thead><tbody>' +
        row('2025', 25, '') + row('2025 after the 5.7% cut', 25, 's') + row('2026 expected', 26, '') + row('2026 expected after a 5.7% cut', 26, 's') +
        '</tbody></table><p>For 2025 the farm gets the higher program; for 2026 only the program it enrolls in pays. Before payment limits.</p>' +
        '<p>Inputs: ' + esc(x.i ? x.i + '; ' : '') + '85% of base acres paid. ' + esc(sh.getAttribute('data-src')) + '. 5.7% is the sequestration rate reported for ' +
        'these payments; it is set each fiscal year and can change.</p>' +
        '<p><b>Estimate, not an FSA determination.</b> Your county FSA office has the official figures. ' + esc(sh.getAttribute('data-u')) + '</p>';
    }
    var pr = q('print');
    if (pr) pr.addEventListener('click', function () { show(); w.print(); });
    show();
    sel.addEventListener('change', function () {
      var x = X[sel.value];
      if (!x) return;
      yIn.value = x.py;
      q('u').textContent = x.u === 'lb' ? 'lb' : 'bu';
      show();
    });
    bIn.addEventListener('input', show);
    yIn.addEventListener('input', show);
  }

  function boot() { levels(); glossary(); tabs(); finder(); runOpen(); hubs(); payCalc(); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);
