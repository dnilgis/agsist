/* grain-shrink-ui.js: the /grain-shrink page (2026-10-16).
 *
 * One moisture box decides the answer: over the elevator's base it is wet
 * grain (shrink plus drying charge, net for the load); under base it is
 * overdry grain (bushels and dollars given away). The math is
 * components/grain-shrink.js (window.AgShrink).
 *
 * The bid: typed by the reader, or the nearest posted bid to their ZIP from
 * the elevator network (components/bids-network.js, the same reader the
 * futures pages and /store-or-sell use), re-marked to today's futures on the
 * /cash-bids rule (components/cb-rank.js) when the board is a day old, or,
 * with no ZIP, the latest futures price (a settle, or delayed with its read
 * time) less the state's median basis (data/basis-states.json). Each is labeled for
 * what it is. Nothing is filled in that the data does not carry.
 *
 * The reader's elevator settings live in localStorage (agsist-shrink); the
 * ZIP in agsist_user_zip, shared with the rest of the site.
 */
(function () {
  'use strict';
  var S = window.AgShrink, NET = window.AGSIST_BIDS_NET;
  if (!S) return;
  var KEY = 'agsist-shrink', ZKEY = 'agsist_user_zip';
  var DEF = {
    corn:     { m: 20,   lbs: 56000 },
    soybeans: { m: 10,   lbs: 60000 },
    wheat:    { m: 15,   lbs: 60000 },
    sorghum:  { m: 17,   lbs: 56000 }
  };
  var st = { crop: 'corn', bidFrom: '', zip: '', snap: null, near: null, prices: null, basis: null, seq: 0, defBid: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function val(id, lo, hi) {
    var el = $(id); if (!el) return null;
    var t = String(el.value).trim(), n = t === '' ? null : parseFloat(t);
    var ok = n != null && isFinite(n) && n >= lo && n <= hi;
    el.setAttribute('aria-invalid', t !== '' && !ok ? 'true' : 'false');
    return ok ? n : null;
  }
  function money(v) { return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dollars(v) { return (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function bu(v, d) { return v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function pct(v, d) { return v.toFixed(d == null ? 1 : d) + '%'; }
  function cents(v) { return Math.round(v * 100) + '¢'; }
  function radio(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
  function ctTime(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    try { return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT'; } catch (e) { return ''; }
  }
  function mdy(iso) {
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* "Oct 2026 delivery" from the row's period (2026-10 or 2026-10/2026-12). */
  function delivWord(n) {
    var m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?/.exec(String(n.period || ''));
    if (m) {
      var a = MON[+m[2] - 1] + ' ' + m[1];
      if (m[3] && (m[3] !== m[1] || m[4] !== m[2])) a = MON[+m[2] - 1] + (m[3] !== m[1] ? ' ' + m[1] : '') + ' to ' + MON[+m[4] - 1] + ' ' + m[3];
      return a + ' delivery';
    }
    return n.delivery ? String(n.delivery) : '';
  }

  /* ── saved settings ─────────────────────────────────────────── */
  function saved() { try { var s = JSON.parse(lsGet(KEY) || 'null'); return s && typeof s === 'object' ? s : {}; } catch (e) { return {}; } }
  function save() {
    var tiers = [].map.call(document.querySelectorAll('#gs-tiers tbody tr'), function (tr) {
      return [tr.querySelector('[data-t=u]').value, tr.querySelector('[data-t=c]').value];
    });
    lsSet(KEY, JSON.stringify({
      crop: st.crop, state: $('gs-state').value, method: radio('gs-method'), factor: $('gs-factor').value,
      handling: $('gs-handling').value, dry: radio('gs-dry'), cpp: $('gs-cpp').value, tiers: tiers,
      yield: $('gs-yield').value, acres: $('gs-acres').value,
      fmode: radio('gs-fmode'), lp: $('gs-lp').value, gal: $('gs-gal').value, kwh: $('gs-kwh').value, hp: $('gs-hp').value,
      buhr: $('gs-buhr').value, allin: $('gs-allin').value, miles: $('gs-miles').value, haul: $('gs-haul').value, fhand: $('gs-fhand').value
    }));
  }
  function restore() {
    var s = saved();
    if (s.crop && S.CROPS[s.crop]) st.crop = s.crop;
    if (s.method) { var r = document.querySelector('input[name="gs-method"][value="' + s.method + '"]'); if (r) r.checked = true; }
    if (s.dry) { var d = document.querySelector('input[name="gs-dry"][value="' + s.dry + '"]'); if (d) d.checked = true; }
    if (s.fmode) { var fm = document.querySelector('input[name="gs-fmode"][value="' + s.fmode + '"]'); if (fm) fm.checked = true; }
    ['factor', 'handling', 'cpp', 'yield', 'acres', 'lp', 'gal', 'kwh', 'hp', 'buhr', 'allin', 'miles', 'haul', 'fhand'].forEach(function (k) { if (s[k] != null && s[k] !== '') $('gs-' + k).value = s[k]; });
    if (Array.isArray(s.tiers)) [].forEach.call(document.querySelectorAll('#gs-tiers tbody tr'), function (tr, i) {
      if (!s.tiers[i]) return; tr.querySelector('[data-t=u]').value = s.tiers[i][0] || ''; tr.querySelector('[data-t=c]').value = s.tiers[i][1] || '';
    });
    st.savedState = s.state || '';
  }

  /* ── crop ───────────────────────────────────────────────────── */
  function setCrop(c, keepInputs) {
    st.crop = c;
    var C = S.CROPS[c];
    [].forEach.call(document.querySelectorAll('[data-crop]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-crop') === c)); });
    if (!keepInputs) {
      $('gs-m').value = DEF[c].m;
      $('gs-base').value = C.base;
      $('gs-lbs').value = DEF[c].lbs;
      var r = document.querySelector('input[name="gs-method"][value="' + C.method + '"]'); if (r) r.checked = true;
      $('gs-factor').value = C.factor;
    }
    $('gs-tw').textContent = C.tw;
    if (st.bidFrom === 'typed') { $('gs-bid').value = ''; st.bidFrom = ''; }
    pickBid();
  }

  /* ── the bid ─────────────────────────────────────────────────── */
  function loadData() {
    var p1 = fetch('/data/prices.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var p2 = fetch('/data/basis-states.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return Promise.all([p1, p2]).then(function (a) {
      st.prices = a[0]; st.basis = a[1];
      if (window.cbRank && st.prices) { try { window.cbRank.setFutures(st.prices); } catch (e) {} }
      fillStates();
    });
  }
  function fillStates() {
    var sel = $('gs-state'), b = st.basis && st.basis.states;
    if (!sel || !b) return;
    var cur = sel.value || st.savedState || '';
    var keys = Object.keys(b).filter(function (k) {
      var c = b[k].crops || {};
      return Object.keys(c).some(function (x) { return c[x] && typeof c[x].median === 'number'; });
    }).sort(function (x, y) { return String(b[x].name).localeCompare(String(b[y].name)); });
    sel.innerHTML = '<option value="">Pick a state</option>' + keys.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(b[k].name || k) + '</option>';
    }).join('');
  }
  function setBid(v, from, line) {
    st.bidFrom = from;
    $('gs-bid').value = v == null ? '' : (Math.round(v * 100) / 100).toFixed(2);
    $('gs-bidsrc').innerHTML = line;
  }
  function pickBid() {
    var c = st.crop, word = S.CROPS[c].name;
    if (st.bidFrom === 'typed') { render(); return; }
    if (st.snap) {
      var n = S.nearestBid(st.snap, c);
      if (n) {
        zipLine(n, word, '');
        /* A day-old board may state its futures month in its own file; with
           it, the bid re-marks to today's futures the way /cash-bids does. */
        var z = S.zipBid(n, '', window.cbRank, Date.now());
        if (z && z.old && NET && n.sourceId) {
          var seq = st.seq;
          NET.sourceFile(n.sourceId).then(function (f) {
            if (seq !== st.seq || st.bidFrom !== 'zip' || st.crop !== c) return;
            var sym = boardSymbol(f, n);
            if (sym) { zipLine(n, word, sym); render(); }
          }).catch(function () {});
        }
        render(); return;
      }
    }
    var stc = $('gs-state').value;
    var d = stc ? S.defaultBid(st.prices, st.basis, stc, c) : null;
    st.defBid = d;
    if (d) {
      setBid(d.bid, 'state', 'State estimate, not a posted bid: ' + esc(d.label) + ' futures ' + money(d.futures) +
        ' (' + esc(S.futuresWhen({ settled: d.settled, date: d.futuresDate, read: d.futuresRead })) + ') ' + (d.basis < 0 ? 'less' : 'plus') + ' the ' + esc(d.stateName) + ' median basis of ' +
        cents(Math.abs(d.basis)) + ' across ' + d.n + ' elevators' + (d.cls.indexOf('wheat_') === 0 ? ' (' + d.cls.slice(6).toUpperCase() + ' wheat)' : '') +
        (d.asOf ? ', ' + esc(mdy(d.asOf)) : '') + '. Your ZIP gets the nearest real bid.');
    } else {
      var why = st.snap ? 'No elevator near ' + esc(st.zip) + ' posts a ' + esc(word) + ' bid right now. ' : '';
      if (stc && c === 'sorghum') why += 'There is no state median for sorghum basis. ';
      else if (stc && st.basis) why += 'No ' + esc(word) + ' basis median for that state. ';
      setBid(null, '', why + 'Type your bid to see dollars.');
    }
    render();
  }
  /* The futures month the board itself states for this row, or ''. Only when
     every matching row (same commodity, delivery and cash) agrees. */
  function boardSymbol(f, n) {
    var rows = (f && Array.isArray(f.bids) ? f.bids : []).filter(function (b) {
      return b && b.cash === n.cashPrice && String(b.delivery || '') === String(n.delivery || '') &&
        String(b.commodity || '').toLowerCase() === String(n.commodity || '').toLowerCase();
    });
    var syms = {};
    rows.forEach(function (b) { if (b.futuresMonth) syms[String(b.futuresMonth).toUpperCase()] = 1; });
    var k = Object.keys(syms);
    return k.length === 1 ? k[0] : '';
  }
  /* "Read" when the time is only when AGSIST read the board, "Posted" when
     the board moved then (the /cash-bids rule, readTimeOnly). */
  function readOnly(n) {
    if (!n.pricedAt) return true;
    var p = Date.parse(n.pricedAt), c = Date.parse(n.checkedAt || '');
    return !isFinite(p) || (isFinite(c) && p === c);
  }
  function zipLine(n, word, sym) {
    var z = S.zipBid(n, sym, window.cbRank, Date.now()) || { price: n.cashPrice };
    var where = esc(n.facility || 'Elevator') + (n.town || n.city ? ', ' + esc(String(n.town || n.city).replace(/,\s*[A-Z]{2}$/, '')) : '') + (n.state ? ' ' + esc(n.state) : '');
    var t = n.pricedAt || n.checkedAt;
    var line = 'Nearest posted ' + esc(word) + ' bid: <b>' + where + '</b>' +
      (n.distance != null ? ', ' + (n.distance < 1 ? 'under a mile' : Math.round(n.distance) + ' miles') + ' from ' + esc(st.zip) : '') +
      (delivWord(n) ? ', for ' + esc(delivWord(n)) : '') +
      (t ? '. ' + (readOnly(n) ? 'Read ' : 'Posted ') + esc(ctTime(t)) : '') + '.';
    if (z.remark) line += ' On today\'s futures that is <b>' + esc(z.text) + '</b> (' + esc(z.note) + '); the page uses ' + esc(z.text) + ', as the cash bids page does.';
    else if (z.old) line += ' Not updated for today\'s futures; the page uses the posted price.';
    setBid(z.price, 'zip', line + ' Call before you haul.');
  }
  function lookupZip() {
    var z = String($('gs-zip').value || '').trim();
    var stat = $('gs-status');
    if (!/^\d{5}$/.test(z)) { stat.textContent = 'Enter a 5-digit ZIP.'; stat.className = 'gs-status err'; return; }
    st.zip = z; lsSet(ZKEY, z);
    if (!NET) { stat.textContent = 'The bid reader did not load. Type your bid.'; stat.className = 'gs-status err'; return; }
    var seq = ++st.seq;
    stat.textContent = 'Reading the elevators near ' + z + '…'; stat.className = 'gs-status';
    if (st.bidFrom === 'typed') st.bidFrom = '';
    NET.snapshotForZip(z).then(function (snap) {
      if (seq !== st.seq) return;
      st.snap = snap;
      if (!snap) {
        var s2 = NET.status(z);
        stat.textContent = s2 === 'failed' ? 'Could not read the elevator bids just now. Try again, or pick a state.' :
          s2 === 'pending' ? 'Still loading the elevator bids. Try again in a moment.' :
          'No elevator we read within 75 miles of ' + z + '. Pick a state or type your bid.';
        stat.className = 'gs-status' + (s2 === 'failed' ? ' err' : '');
      } else {
        stat.textContent = '';
        var first = (snap.bids || [])[0];
        var sel = $('gs-state');
        if (first && first.state && sel && !sel.value && sel.querySelector('option[value="' + first.state + '"]')) sel.value = first.state;
      }
      pickBid(); save();
    });
  }

  /* ── inputs to answer ────────────────────────────────────────── */
  function drying() {
    var k = radio('gs-dry');
    if (k === 'point') { var c = val('gs-cpp', 0, 20); return c == null ? { kind: 'none', missing: true } : { kind: 'point', cents: c }; }
    if (k === 'table') {
      var rows = [].map.call(document.querySelectorAll('#gs-tiers tbody tr'), function (tr) {
        var u = parseFloat(tr.querySelector('[data-t=u]').value), c = parseFloat(tr.querySelector('[data-t=c]').value);
        return isFinite(u) && isFinite(c) ? { upTo: u, cents: c } : null;
      }).filter(Boolean);
      return rows.length ? { kind: 'table', rows: rows } : { kind: 'none', missing: true };
    }
    return { kind: 'none' };
  }
  /* Sell wet (o, from S.wet) against drying it on the farm. Returns math lines. */
  function farmSide(o, m, base, lbs, tw, bid, dr) {
    var box = $('gs-farm'), mode = radio('gs-fmode') || 'fuel';
    document.documentElement.setAttribute('data-fmode', mode);
    var f = S.farm({ m: m, base: base, lbs: lbs, tw: tw, bid: bid, handling: val('gs-fhand', 0, 5), mode: mode,
      lp: val('gs-lp', 0, 10), gal: val('gs-gal', 0.001, 0.1), kwh: val('gs-kwh', 0, 2), hp: val('gs-hp', 1, 1000), buHr: val('gs-buhr', 1, 20000),
      allin: val('gs-allin', 0, 20), miles: val('gs-miles', 0, 500), haul: val('gs-haul', 0, 20) });
    if (!f) { box.innerHTML = '<p class="gs-src">Enter a moisture over base to compare.</p>'; return ''; }
    var miss = f.drying == null ? (mode === 'allin' ? 'Type your all-in cents a bushel a point to count drying.' : 'Type your LP price and gallons a bushel a point to count drying.') : '';
    var elevDry = o.drying == null ? 'past your table' : dr.kind === 'none' ? 'not counted' : dollars(o.drying);
    var rows = [
      ['Bushels sold', bu(o.dryBu, 1), bu(f.dryBu, 1)],
      ['Shrink', pct(o.shrinkPct, 2), pct(f.shrinkPct, 2)],
      ['Drying', elevDry, f.drying == null ? 'fill in' : dollars(f.drying) + (mode === 'fuel' && !f.powerCounted ? ' (LP only)' : '')],
      ['Extra haul', '$0', dollars(f.haul)]
    ];
    var both = bid != null && o.net != null && f.net != null;
    if (bid != null) rows.push(['Net for the load', o.net == null ? 'no answer' : dollars(o.net), f.net == null ? 'fill in' : dollars(f.net)],
      ['Net a wet bushel', o.net == null ? '' : money(o.netPerWetBu), f.net == null ? '' : money(f.netPerWetBu)]);
    var win = both ? (f.net > o.net ? 2 : o.net > f.net ? 1 : 0) : 0;
    var last = rows.length - 1;
    var html = '<div class="gs-tw"><table class="gs-t gs-cmp"><caption class="sr-only">Sell wet against dry it myself</caption><thead><tr><th scope="col"></th><th scope="col">Sell wet</th><th scope="col">Dry it myself</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr><th scope="row">' + r[0] + '</th><td' + (i >= last - 1 && win === 1 ? ' class="win"' : '') + '>' + r[1] + '</td><td' + (i >= last - 1 && win === 2 ? ' class="win"' : '') + '>' + r[2] + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var say = [];
    if (both) {
      var d = f.net - o.net;
      say.push(Math.abs(d) < 0.5 ? 'About even.' : (d > 0 ? 'Drying it yourself nets ' : 'Selling wet nets ') + dollars(Math.abs(d)) + ' more on this load, ' + cents(Math.abs(d) / f.wetBu) + ' a wet bushel.');
    }
    if (miss) say.push(miss);
    if (bid == null) say.push('Add a bid to compare dollars.');
    if (dr.kind === 'none' && o.drying != null) say.push('Your elevator\'s drying charge is not counted yet; fill it in above or the elevator side looks better than it is.');
    if (mode === 'fuel' && f.drying != null && !f.powerCounted) say.push('Electricity is not counted until all three power boxes are filled.');
    box.innerHTML = html + (say.length ? '<p class="gs-src">' + say.join(' ') + '</p>' : '');
    var L = '\n\nDry it myself\n' +
      'Dry matter = ' + bu(lbs) + ' x (100 - ' + m + ') / 100 = ' + bu(f.dryMatterLb, 0) + ' lb\n' +
      'At ' + base + '% = ' + bu(f.dryMatterLb, 0) + ' / ' + ((100 - base) / 100).toFixed(3) + ' = ' + bu(f.atBaseLb, 0) + ' lb\n' +
      'Handling ' + f.handlingPct + '% of ' + bu(lbs) + ' = ' + bu(f.handlingLb, 0) + ' lb\n' +
      'Bushels = (' + bu(f.atBaseLb, 0) + ' - ' + bu(f.handlingLb, 0) + ') / ' + tw + ' = ' + bu(f.dryBu, 2);
    if (f.fuel != null) L += '\nLP = ' + val('gs-gal', 0.001, 0.1) + ' gal x ' + bu(f.wetBu, 2) + ' bu x ' + bu(f.points, 2) + ' pts = ' + bu(f.gallons, 1) + ' gal x ' + money(val('gs-lp', 0, 10)) + ' = ' + money(f.fuel);
    if (f.powerCounted) L += '\nPower = ' + val('gs-hp', 1, 1000) + ' hp x 0.746 x ' + money(val('gs-kwh', 0, 2)) + ' / ' + val('gs-buhr', 1, 20000) + ' bu/h x ' + bu(f.dryBu, 2) + ' bu = ' + money(f.power);
    if (mode === 'allin' && f.drying != null) L += '\nDrying = ' + val('gs-allin', 0, 20) + 'c x ' + bu(f.points, 2) + ' pts x ' + bu(f.wetBu, 2) + ' bu = ' + money(f.drying);
    if (f.haul) L += '\nHaul = ' + val('gs-miles', 0, 500) + ' mi x ' + val('gs-haul', 0, 20) + 'c x ' + bu(f.wetBu, 2) + ' bu = ' + money(f.haul);
    if (f.net != null) L += '\nNet = ' + bu(f.dryBu, 2) + ' x ' + money(bid) + ' - ' + money(f.drying) + (f.haul ? ' - ' + money(f.haul) : '') + ' = ' + money(f.net);
    return L;
  }
  function kv(list) { return list.map(function (x) { return '<div><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join(''); }

  function render() {
    var C = S.CROPS[st.crop], word = C.name;
    var m = val('gs-m', 5, 40), base = val('gs-base', 8, 20), lbs = val('gs-lbs', 100, 2000000), bid = val('gs-bid', 0.01, 100);
    var V = $('gs-verdict'), sub = $('gs-sub'), box = $('gs-kv'), fine = $('gs-fine'), ans = $('gs-answer'), math = $('gs-math');
    $('gs-tiers').hidden = radio('gs-dry') !== 'table';
    if (m == null || base == null || lbs == null) {
      document.documentElement.setAttribute('data-gs', '');
      V.textContent = 'Enter the moisture, the base and the load.'; sub.textContent = ''; box.innerHTML = ''; fine.textContent = '';
      ans.className = 'gs-answer'; math.textContent = 'Enter a moisture and a load.'; return;
    }
    var tw = C.tw, wetBu = lbs / tw;
    if (m > base) {
      document.documentElement.setAttribute('data-gs', 'wet');
      var method = radio('gs-method') || 'factor';
      var dr = drying();
      var o = S.wet({ m: m, base: base, lbs: lbs, tw: tw, bid: bid, method: method, factor: val('gs-factor', 1, 3), handling: val('gs-handling', 0, 5), drying: dr });
      if (!o) { V.textContent = 'Check the numbers.'; return; }
      ans.className = 'gs-answer v-wet';
      if (bid != null && o.net != null) {
        V.textContent = dollars(o.net) + ' for the load: ' + money(o.netPerWetBu) + ' a wet bushel, ' + cents(bid - o.netPerWetBu) + ' under your ' + money(bid) + ' bid.';
      } else if (bid != null && o.drying == null) {
        V.textContent = bu(o.dryBu) + ' dry bushels. Your drying table stops below ' + pct(m) + '.';
      } else {
        V.textContent = bu(wetBu) + ' wet bushels shrink to ' + bu(o.dryBu) + ' dry bushels.';
      }
      sub.textContent = bu(wetBu) + ' wet bushels at ' + pct(m) + ' shrink ' + pct(o.shrinkPct, 2) + ' (' + bu(o.points, 1) + ' points over ' + pct(base) + ') to ' + bu(o.dryBu, 1) + ' bushels.' +
        (dr.kind === 'none' ? (dr.missing ? ' Drying charge: fill in the numbers to count it.' : ' No drying charge counted.') :
          o.drying == null ? ' Drying: no band in your table covers ' + pct(m) + '.' : ' Drying charge ' + dollars(o.drying) + ' (' + cents(o.dryingPerBu) + ' a wet bushel).');
      var items = [[bu(o.shrinkBu, 1) + ' bu', 'shrink, ' + pct(o.shrinkPct, 2)]];
      if (bid != null) items.push([dollars(o.shrinkDollars), 'shrink at your bid']);
      if (o.drying != null && o.drying > 0) items.push([dollars(o.drying), 'drying charge']);
      if (bid != null && o.net != null && o.drying > 0) items.push([money(o.net / o.dryBu), 'net a dry bushel, after drying']);
      box.innerHTML = kv(items);
      var h = o.handlingPct;
      fine.textContent = (method === 'factor' ? 'Of that ' + pct(o.shrinkPct, 2) + ', water is ' + pct(o.waterPct, 2) + ' and the rest, ' + pct(h, 2) + ', is handling loss the factor assumes.' +
        (h > 1 ? ' NCH-61 calls more than 1% a bigger loss than on-farm and commercial surveys found.' : '') : 'Water ' + pct(o.waterPct, 2) + ' plus ' + pct(h, 2) + ' handling.') +
        (bid == null ? ' Add a bid for dollars.' : '');
      math.textContent =
        'Wet bushels = ' + bu(lbs) + ' lb / ' + tw + ' = ' + bu(wetBu, 2) + '\n' +
        'Points over base = ' + m + ' - ' + base + ' = ' + bu(o.points, 2) + '\n' +
        (method === 'factor'
          ? 'Shrink = ' + bu(o.points, 2) + ' x ' + val('gs-factor', 1, 3) + '% = ' + pct(o.shrinkPct, 3) + '\n'
          : 'Water shrink = 100 x ' + bu(o.points, 2) + ' / (100 - ' + base + ') = ' + pct(o.waterPct, 3) + '\nShrink = ' + pct(o.waterPct, 3) + ' + ' + pct(h, 2) + ' = ' + pct(o.shrinkPct, 3) + '\n') +
        'Dry bushels = ' + bu(wetBu, 2) + ' x (1 - ' + (o.shrinkPct / 100).toFixed(5) + ') = ' + bu(o.dryBu, 2) + '\n' +
        (o.drying ? 'Drying = ' + bu(wetBu, 2) + ' x ' + cents(o.dryingPerBu) + ' = ' + money(o.drying) + '\n' : '') +
        (bid != null && o.net != null ? 'Net = ' + bu(o.dryBu, 2) + ' x ' + money(bid) + (o.drying ? ' - ' + money(o.drying) : '') + ' = ' + money(o.net) + '\nPer wet bushel = ' + money(o.net) + ' / ' + bu(wetBu, 2) + ' = ' + money(o.netPerWetBu) : 'Add a bid for dollars.') +
        farmSide(o, m, base, lbs, tw, bid, dr);
    } else if (m < base) {
      document.documentElement.setAttribute('data-gs', 'dry');
      var y = val('gs-yield', 1, 400), ac = val('gs-acres', 1, 1000000);
      var d = S.overdry({ m: m, base: base, bu: wetBu, bid: bid, yieldBu: y, acres: ac });
      ans.className = 'gs-answer v-dry';
      V.textContent = bid != null
        ? 'Delivering ' + word + ' at ' + pct(m) + ' gave away ' + bu(d.extraBu, 1) + ' bushels on this load: ' + dollars(d.dollars) + ' at ' + money(bid) + '.'
        : 'Delivering ' + word + ' at ' + pct(m) + ' gave away ' + bu(d.extraBu, 1) + ' bushels on this load.';
      sub.textContent = 'You hauled ' + bu(wetBu, 1) + ' bushels. At ' + pct(base) + ' the same grain would have weighed ' + bu(lbs * d.ratio) + ' lb, ' + bu(d.atBase, 1) + ' bushels. That is ' + pct(d.lossPct) + ' of the crop not paid for.';
      var it = [[bu(d.extraPer1000, 1) + ' bu', 'per 1,000 bu delivered']];
      if (bid != null) it.push([dollars(d.dollarsPer1000), 'per 1,000 bu at your bid']);
      if (d.extraPerAcre != null) it.push([bu(d.extraPerAcre, 2) + ' bu', 'an acre at ' + bu(y) + ' bu/ac']);
      if (d.dollarsPerAcre != null) it.push([money(d.dollarsPerAcre), 'an acre']);
      if (d.dollarsFarm != null) it.push([dollars(d.dollarsFarm), 'on ' + bu(ac) + ' acres']);
      box.innerHTML = kv(it);
      fine.textContent = (y == null ? 'Add your yield under "Per acre" for the per-acre cost. ' : '') + (bid == null ? 'Add a bid for dollars. ' : '') +
        'Grain is not paid extra for being dry; it is weighed at ' + tw + ' lb a bushel no matter the moisture.';
      math.textContent =
        'Bushels delivered = ' + bu(lbs) + ' lb / ' + tw + ' = ' + bu(wetBu, 2) + '\n' +
        'Bushels at base = ' + bu(wetBu, 2) + ' x (100 - ' + m + ') / (100 - ' + base + ') = ' + bu(d.atBase, 2) + '\n' +
        'Given away = ' + bu(d.atBase, 2) + ' - ' + bu(wetBu, 2) + ' = ' + bu(d.extraBu, 2) + ' bu' +
        (bid != null ? '\nDollars = ' + bu(d.extraBu, 2) + ' x ' + money(bid) + ' = ' + money(d.dollars) : '') +
        (d.extraPerAcre != null ? '\nPer acre = ' + y + ' x (' + d.ratio.toFixed(5) + ' - 1) = ' + bu(d.extraPerAcre, 3) + ' bu' : '');
    } else {
      document.documentElement.setAttribute('data-gs', '');
      ans.className = 'gs-answer v-ok';
      V.textContent = 'Right at base: no shrink, nothing given away.';
      sub.textContent = bu(wetBu, 1) + ' bushels' + (bid != null ? ', ' + dollars(wetBu * bid) + ' at ' + money(bid) + '.' : '.');
      box.innerHTML = ''; fine.textContent = '';
      math.textContent = 'Bushels = ' + bu(lbs) + ' lb / ' + tw + ' = ' + bu(wetBu, 2);
    }
  }

  /* ── wiring ─────────────────────────────────────────────────── */
  function init() {
    restore();
    var q = {};
    try { q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) {}
    var c = String(q.crop || '').toLowerCase();
    if (c === 'beans' || c === 'soybean') c = 'soybeans';
    if (c === 'milo') c = 'sorghum';
    if (S.CROPS[c]) st.crop = c;
    setCrop(st.crop);
    restore();
    if (q.m && isFinite(parseFloat(q.m))) $('gs-m').value = parseFloat(q.m);
    var z = String(q.zip || lsGet(ZKEY) || '').trim();
    if (/^\d{5}$/.test(z)) $('gs-zip').value = z;
    render();

    [].forEach.call(document.querySelectorAll('[data-crop]'), function (b) {
      b.addEventListener('click', function () { setCrop(b.getAttribute('data-crop')); save(); });
    });
    [].forEach.call(document.querySelectorAll('[data-ex]'), function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-ex') === 'wet') { setCrop('corn'); $('gs-m').value = 20.5; }
        else { setCrop('soybeans'); $('gs-m').value = 10; }
        render(); save();
      });
    });
    $('gs-bid').addEventListener('input', function () {
      st.bidFrom = String(this.value).trim() ? 'typed' : '';
      $('gs-bidsrc').textContent = st.bidFrom ? 'Your bid.' : 'Type your bid, or let the page fill one in.';
      render();
    });
    $('gs-zipgo').addEventListener('click', lookupZip);
    $('gs-zip').addEventListener('keydown', function (e) { if (e.key === 'Enter') lookupZip(); });
    $('gs-state').addEventListener('change', function () { if (st.bidFrom === 'typed') st.bidFrom = ''; if (!st.snap || !S.nearestBid(st.snap, st.crop)) pickBid(); save(); });
    document.querySelector('.gs').addEventListener('input', function (e) {
      if (e.target.id === 'gs-bid' || e.target.id === 'gs-zip') return;
      render(); save();
    });
    document.querySelector('.gs').addEventListener('change', function (e) {
      if (e.target.name === 'gs-method' || e.target.name === 'gs-dry' || e.target.name === 'gs-fmode') { render(); save(); }
    });

    loadData().then(function () {
      if (/^\d{5}$/.test($('gs-zip').value)) lookupZip(); else pickBid();
    });
    window.addEventListener('agsist:bids-net-ready', function () { if (st.zip && !st.snap) lookupZip(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
