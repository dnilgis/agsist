/* components/your-area.js: the "Your area" box on /daily and every issue page,
   /scorecard, /cot and /whats-priced-in. A page opts in with one hidden element
   after its main answer, plus this script (defer):
     <aside class="ya" data-your-area="daily|cot|scorecard|wpi" hidden></aside>
   data-after="<selector>": move the box after that element once JS draws it.
   READS ONLY the location the site already saved (agsist-wx-loc from geo.js,
   else agsist_zip). Writes nothing, sends nothing about the reader; it fetches
   public files from this site and does the arithmetic here:
   state median basis + week change (data/basis-states.json); futures close +
   that basis, only for the same contract within 5 days (data/prices.json);
   state harvest pace (data/crop-progress.json); per page, a futures move
   reaches a bid one for one and basis is not covered by futures. Stale or
   missing data stays missing. No location: one link to the ZIP search.
   Tests: test/your-area.test.mjs. */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FR = { 0: '', 25: '¼', 50: '½', 75: '¾' };
  var CROPS = [['corn', 'Corn'], ['soybeans', 'Soybeans']];
  var DAY = 864e5;

  function readLoc(ls) {
    var o = null, z = '';
    try { o = JSON.parse(ls.getItem('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (o && typeof o === 'object') {
      var st = /^[A-Z]{2}$/.test(o.state || '') ? o.state : '';
      z = /^\d{5}$/.test(o.zip || '') ? o.zip : '';
      if (st || z) return { state: st, zip: z };
    }
    try { z = String(ls.getItem('agsist_zip') || ''); } catch (e) { z = ''; }
    return /^\d{5}$/.test(z) ? { state: '', zip: z } : null;
  }
  /* cents to the nearest quarter, as a grain board writes it: 56.5 -> "56½" */
  function qc(c) {
    var q = Math.round(Math.abs(c) * 4) / 4, w = Math.floor(q), f = Math.round((q - w) * 100);
    return (w || !f ? String(w) : '') + FR[f];
  }
  /* a futures price in cents as a board prints it: 500.25 -> "$5.00¼" */
  function fut(c) {
    var q = Math.round(c * 4) / 4, w = Math.floor(q / 100), r = q - w * 100, rc = Math.floor(r);
    return '$' + w + '.' + (rc < 10 ? '0' : '') + rc + FR[Math.round((r - rc) * 100)];
  }
  function basisWords(med) {
    var c = Math.round(med * 1e6) / 1e4;
    if (Math.abs(c) < 0.125) return 'even with';
    return qc(c) + '¢ ' + (c < 0 ? 'under' : 'over');
  }
  function wowWords(w) {
    if (w == null || !isFinite(w)) return '';
    if (w === 0) return 'unchanged on the week';
    return qc(w) + '¢ ' + (w > 0 ? 'stronger' : 'weaker') + ' on the week';
  }
  /* futures close (cents) + median basis ($), to the cent: 474.25 + -0.565 -> 4.18 */
  function cashAt(closeCents, med) { return Math.round(Math.round((closeCents + med * 100) * 1e6) / 1e6) / 100; }
  function ct(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(d); }
    catch (e) { return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  }
  function day(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function age(iso, now) { var t = Date.parse(iso); return isNaN(t) ? Infinity : (now - t) / DAY; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function quoteFor(prices, contract) {
    var q = prices && prices.quotes, t = contract + '.CBT';
    if (!q) return null;
    for (var k in q) if (q[k] && q[k].ticker === t && typeof q[k].close === 'number') return q[k];
    return null;
  }
  /* "Dec '26 corn settled 20½¢ lower that day, $5.00¼ to $4.79¾ ..."; the
     move must match its own two prices or nothing is printed. */
  function parseFr(s) { var m = /^(\d*)([¼½¾]?)$/.exec(s); if (!m || (!m[1] && !m[2])) return NaN; return (+m[1] || 0) + ({ '¼': .25, '½': .5, '¾': .75 }[m[2]] || 0); }
  function parseReaction(s) {
    var m = /^([A-Z][a-z]{2} '\d\d) (corn|soybeans) settled ([\d¼½¾]+)¢ (lower|higher) that day, \$(\d+)\.(\d\d)([¼½¾]?) to \$(\d+)\.(\d\d)([¼½¾]?)/.exec(s || '');
    if (!m) return null;
    var mv = parseFr(m[3]), a = +m[5] * 100 + parseFr(m[6] + m[7]), b = +m[8] * 100 + parseFr(m[9] + m[10]);
    var d = m[4] === 'lower' ? a - b : b - a;
    if (!(mv > 0) || Math.abs(d - mv) > 1e-9) return null;
    return { month: m[1], crop: m[2], cents: mv, dir: m[4] };
  }

  /* The lines, as HTML. Pure: the tests call it with fixtures. */
  function build(o) {
    var loc = o.loc, mode = o.mode, now = o.now || Date.now(), out = [], src = [];
    var bs = o.basis, st = bs && bs.states && loc.state ? bs.states[loc.state] : null;
    var name = st && st.name ? st.name : '';
    var basisOk = st && bs.generated && age(bs.generated, now) <= 10;
    var crops = {};
    if (basisOk) {
      CROPS.forEach(function (c) {
        var b = st.crops && st.crops[c[0]];
        if (!b || typeof b.median !== 'number' || !isFinite(b.median)) return;
        crops[c[0]] = b;
        var s = '<b>' + c[1] + '</b> basis ' + basisWords(b.median) + ' ' + esc(b.label || b.contract);
        var w = wowWords(b.wow);
        s += (w ? ', ' + w : '') + ' (' + b.n + ' elevator' + (b.n === 1 ? '' : 's') + ').';
        var q = quoteFor(o.prices, b.contract);
        if (q && q.close_date && Math.abs(age(q.close_date + 'T12:00:00Z', Date.parse(bs.generated))) <= 5)
          s += ' ' + esc(b.label) + ' closed ' + fut(q.close) + ' ' + day(q.close_date) + ': about $' + cashAt(q.close, b.median).toFixed(2) + ' at that basis.';
        out.push(s);
      });
      if (out.length) src.push('Median basis of AGSIST network elevators in ' + esc(name) + ', bids as of ' + ct(bs.generated) + (bs.prev ? ', week vs ' + ct(bs.prev) : ''));
    }
    var cp = o.progress, sp = cp && cp.in_season && cp.states && loc.state ? cp.states[loc.state] : null;
    if (sp) {
      var h = [], dt = '';
      CROPS.forEach(function (c) {
        var r = sp[c[0] + '_harvested'];
        if (!r || typeof r.pct !== 'number' || age(r.date + 'T12:00:00Z', now) > 21) return;
        dt = r.date;
        h.push(c[1].toLowerCase() + ' ' + r.pct + '%' + (typeof r.avg5 === 'number' ? ' (5-yr avg ' + r.avg5 + '%)' : ''));
      });
      if (h.length) { out.push('<b>Harvest</b> in ' + esc(name || loc.state) + ': ' + h.join(', ') + '.'); src.push('USDA NASS crop progress, week ending ' + day(dt) + ' (5-yr avg is AGSIST arithmetic on NASS weeks)'); }
    }
    var lead = crops.corn ? 'corn' : (crops.soybeans ? 'soybeans' : '');
    var who = name ? (/^[AEIOU]/.test(name) ? 'an ' : 'a ') + esc(name) + ' ' : 'your ', moved = false;
    if (mode === 'wpi' && o.wpi && o.wpi.latest_result) {
      var lr = o.wpi.latest_result, rb = lr.biggest_surprise || {}, r = rb.reaction_from === 'settles' ? parseReaction(rb.reaction) : null;
      if (r && age(lr.date + 'T12:00:00Z', now) <= 45 && (moved = true))
        out.push('The ' + esc(lr.report) + ' (' + day(lr.date) + ') moved ' + esc(r.month) + ' ' + r.crop + ' ' + qc(r.cents) + '¢ ' + r.dir + ' that day. Where basis held, ' + who + r.crop + ' bid moved the same ' + qc(r.cents) + '¢. Basis is not covered by futures; it moves on its own.');
    }
    var tail = {
      daily: 'Futures moves in this briefing reach ' + who + 'bid cent for cent. Basis moves on its own and is not in the futures price.',
      cot: 'Fund positions are national. They push futures, and a futures move reaches ' + who + 'bid cent for cent. Basis is not covered by futures or by this report; it moves on local supply, freight and what the elevator needs.',
      scorecard: 'Calls here are graded on futures. A call that is right by 10¢ moves ' + who + 'bid the same 10¢ only if basis holds. Basis is not graded here.',
      wpi: 'A report moves futures, and futures reach ' + who + 'bid cent for cent. Basis is not covered by futures; your own number to beat is on the break-even page.'
    }[mode];
    if (tail && !moved) out.push(tail);
    var links = [];
    if (loc.zip) links.push('<a href="/cash-bids?zip=' + loc.zip + '">Bids near ' + loc.zip + ' &rarr;</a>');
    if (st && st.path && lead) links.push('<a href="' + esc(st.path) + '">' + esc(name) + ' basis map</a>');
    return '<p class="ya-k">Your area' + (name ? ': ' + esc(name) : '') + (src.length && basisOk ? ' &middot; ' + ct(bs.generated) : '') + '</p>' +
      out.map(function (s) { return '<p>' + s + '</p>'; }).join('') +
      (links.length ? '<p class="ya-l">' + links.join(' &middot; ') + '</p>' : '') +
      (src.length ? '<p class="ya-s">' + src.join('. ') + '.</p>' : '');
  }
  function none() { return '<p class="ya-none"><a href="/cash-bids">See this for your area</a></p>'; }

  var api = { readLoc: readLoc, build: build, none: none, qc: qc, fut: fut, cashAt: cashAt, basisWords: basisWords, wowWords: wowWords, parseReaction: parseReaction };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AGSIST_YOUR_AREA = api;

  var doc = root.document, CSS = 'aside.ya{margin:1rem 0;padding:.7rem .9rem;border:1px solid var(--border);border-left:3px solid var(--green);border-radius:8px;background:var(--surface);font-size:.88rem;line-height:1.55;color:var(--text-dim)}aside.ya p{margin:.25rem 0;font-size:inherit;line-height:inherit;color:inherit}aside.ya b{color:var(--text)}aside.ya .ya-k{font-family:"JetBrains Mono",monospace;font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green)}aside.ya a{color:var(--gold);display:inline-block;padding:.35rem 0}aside.ya .ya-s{font-size:.76rem;color:var(--text-muted)}aside.ya.ya-n{border:0;background:none;padding:0;margin:.5rem 0}';
  function get(u) { return fetch(u, { cache: 'default' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function fill(el, loc) {
    var mode = el.getAttribute('data-your-area') || 'daily';
    Promise.all([get('/data/basis-states.json'), get('/data/crop-progress.json'), get('/data/prices.json'),
      mode === 'wpi' ? get('/data/whats-priced-in.json') : null]).then(function (r) {
      el.innerHTML = build({ loc: loc, mode: mode, basis: r[0], progress: r[1], prices: r[2], wpi: r[3] });
    });
  }
  function place(el) {
    var sel = el.getAttribute('data-after'), n = 0;
    if (!sel) return;
    (function look() {
      var t = doc.querySelector(sel);
      if (t && t.parentNode) { t.parentNode.insertBefore(el, t.nextSibling); return; }
      if (++n < 40) setTimeout(look, 250);
    })();
  }
  function boot() {
    var els = doc.querySelectorAll('[data-your-area]');
    if (!els.length) return;
    var loc = null;
    try { loc = readLoc(root.localStorage); } catch (e) { loc = null; }
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    Array.prototype.forEach.call(els, function (el) {
      place(el);
      el.hidden = false;
      if (!loc) { el.className += ' ya-n'; el.innerHTML = none(); return; }
      el.innerHTML = build({ loc: loc, mode: el.getAttribute('data-your-area') });
      if (!('IntersectionObserver' in root)) return fill(el, loc);
      var io = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fill(el, loc); }
      }, { rootMargin: '600px 0px' });
      io.observe(el);
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
