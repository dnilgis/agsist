/* PRF STATE SPONSORS (Sig, 2026-10-13).
 *
 * One business per state can sponsor PRF there: the state page
 * (prf/<state>.html), every county page in it (prf/<state>/<county>.html) and,
 * on /prf, a box beside the result when a reader's grid is in that state.
 * On the state and county pages the sponsor takes the place of the unsold
 * offer band, which sits under the opening answer, near the top (Sig,
 * 2026-10-14), so a sold block shows in that same upper spot.
 *
 * WHERE A SALE LIVES: data/prf-sponsors.json, keyed by state code:
 *   { "IA": { "name": "...", "url": "https://...", "line": "one sentence, 120 characters at most",
 *             "logo": "/img/sponsors/x.webp" (optional), "phone": "515-555-0100" (optional),
             "through": "2026-12-31" } }
 * One business may sit under as many states as it bought.
 *
 * WHY THE BROWSER READS IT INSTEAD OF THE GENERATORS BAKING IT IN: the county
 * pages are 3,070 files. Baking a sale in would mean regenerating and
 * committing every page in the state for each sale, renewal and lapse, and a
 * lapse on Dec 31 would need a build on that day to come down. Read here, a
 * sale goes live on the commit of the JSON, and the day after "through"
 * (Central time) the state shows its offer again with nobody touching
 * anything. The pages ship the unsold offer in plain HTML; this swaps it.
 * If the file cannot be read, the offer stays: the figures never depend on it.
 *
 * On /prf a sold state's sponsor also prints on the one-page sheet (#prf-spon-p,
 * renderPrint): labelled Sponsor, name, phone, website, the line and the
 * disclosure. Unsold prints nothing.
 *
 * A sponsor never changes a number or "What the numbers would pick": this
 * file draws one labelled box and touches nothing else.
 *
 * Price on request: nothing here prints, suggests or links to a price.
 * Farmers First never appears in a slot, so an entry naming it is dropped.
 *
 * Every unsold offer links to /prf-sponsor?state=XX (prf-sponsor.html), where
 * a business sees its block drawn by render() below and asks; the mailto to
 * Sig stays beside it as the second way.
 *
 * Tested by test/prf-sponsor.test.mjs (node loads the pure part below).
 */
(function (root) {
  'use strict';
  var LINE_MAX = 120, NAME_MAX = 60;
  var ST_RE = /^[A-Z]{2}$/;
  var URL_RE = /^https?:\/\/[^\s"'<>\\`]+$/i;
  var LOGO_RE = /^\/img\/sponsors\/[a-z0-9._-]+\.(png|jpe?g|webp)$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var PHONE_RE = /^\+?[0-9][0-9 ().-]{6,18}$/;
  var NOT_IN_A_SLOT = /farmers\s*(1st|first)/i;

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* today in Central time, YYYY-MM-DD: the day a placement is checked against */
  function today(now) {
    var d = now || new Date();
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }

  /* The entry for a state if it is sold and still running on `day`, cleaned; else null. */
  function pick(data, st, day) {
    if (!data || typeof data !== 'object' || !ST_RE.test(st || '')) return null;
    var sp = data[st];
    if (!sp || typeof sp !== 'object') return null;
    var name = typeof sp.name === 'string' ? sp.name.trim() : '';
    var url = typeof sp.url === 'string' ? sp.url.trim() : '';
    if (!name || name.length > NAME_MAX || !URL_RE.test(url)) return null;
    if (NOT_IN_A_SLOT.test(name) || NOT_IN_A_SLOT.test(url) || /farmers1st/i.test(url)) return null;
    if (!DATE_RE.test(sp.through || '') || sp.through < day) return null;
    var line = typeof sp.line === 'string' ? sp.line.trim() : '';
    if (line.length > LINE_MAX) line = '';
    var logo = typeof sp.logo === 'string' && LOGO_RE.test(sp.logo) ? sp.logo : '';
    var phone = typeof sp.phone === 'string' && PHONE_RE.test(sp.phone.trim()) ? sp.phone.trim() : '';
    return { st: st, name: name, url: url, line: line, logo: logo, phone: phone, through: sp.through };
  }

  function ask(n) {
    return '<span class="prf-spon-ask">AGSIST is free because businesses like ' + n + ' pay for it. ' +
      'If you do business with them, tell them you saw them here.</span>';
  }
  function visit(sp, n, where) {
    return '<a href="' + esc(sp.url) + '" rel="sponsored noopener" target="_blank" data-sponsor-click="prf-' +
      where + ':' + sp.st + '">Visit ' + n + ' &rarr;</a>';
  }

  /* kind: 'state' (full: logo, line, ask), 'county' (compact: no logo), 'tool' (beside the result) */
  function render(sp, stName, kind) {
    var n = esc(sp.name);
    var logo = kind !== 'county' && sp.logo ? '<img class="ag-sponsor-logo" src="' + esc(sp.logo) + '" alt="" loading="lazy">' : '';
    var noSay = kind === 'state' ? '' : ' <span class="prf-spon-ask">A sponsor has no say over any figure here.</span>';
    return '<span class="ag-sponsor-tag">Sponsor</span>' + logo +
      '<span class="ag-sponsor-copy"><b>PRF in ' + esc(stName) + ' is sponsored by ' + n + '.</b>' +
      (sp.line ? ' ' + esc(sp.line) : '') + (sp.phone ? ' <span class="prf-spon-tel">' + esc(sp.phone) + '</span>.' : '') + ' ' + ask(n) + noSay + '</span>' + visit(sp, n, kind);
  }

  /* The /prf print sheet (Sig, Oct 18): a sold state's sponsor prints, labelled Sponsor, with the
     name, phone and website, the short line, and the standing disclosure. Unsold prints nothing.
     No logo (one ink, one page), no price, no link to click on paper. */
  function site(url) { return String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, ''); }
  function renderPrint(sp) {
    var contact = [sp.phone ? esc(sp.phone) : '', esc(site(sp.url))].filter(Boolean).join(' &middot; ');
    return '<span class="psp-tag">Sponsor</span><span class="psp-copy"><span class="psp-name">' + esc(sp.name) + '</span>' +
      (sp.line ? ' ' + esc(sp.line) : '') + ' <span class="psp-contact">' + contact + '</span>' +
      ' <span class="psp-no">A sponsor has no say over any figure here.</span></span>';
  }

  function show(el, sp, stName, kind) {
    el.className = 'ag-sponsor-ribbon ag-sponsor-ribbon--sold prf-spon prf-spon-' + kind;
    el.setAttribute('data-sponsor-slot', 'prf-' + kind + ':' + sp.st);
    el.setAttribute('aria-label', 'Sponsor: ' + sp.name);
    el.innerHTML = render(sp, stName, kind);
    el.hidden = false;
  }

  var api = { pick: pick, render: render, renderPrint: renderPrint, esc: esc, today: today, LINE_MAX: LINE_MAX };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgPrfSponsor = api;

  var doc = root.document;
  var got = null;
  function load() {
    if (!got) {
      got = root.fetch('/data/prf-sponsors.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('prf-sponsors'); return r.json(); })
        .catch(function () { return null; });
    }
    return got;
  }

  /* State and county pages: the element carries data-prf-st and data-prf-name. */
  var els = doc.querySelectorAll('[data-prf-spon]');
  if (els.length) {
    load().then(function (d) {
      var day = today();
      for (var i = 0; i < els.length; i++) {
        var el = els[i], sp = pick(d, el.getAttribute('data-prf-st'), day);
        if (sp) show(el, sp, el.getAttribute('data-prf-name') || '', el.getAttribute('data-prf-spon'));
      }
    });
  }

  /* /prf: prf.js says which state the grid's county is in, on every render.
     The "For businesses" band under the intro then links to /prf-sponsor
     with that state ticked (2026-10-13; moved up 2026-10-14). */
  var box = doc.getElementById('prf-spon'), pbox = doc.getElementById('prf-spon-p');
  var offer = doc.querySelector ? doc.querySelector('a[data-prf-offer]') : null;
  if (box) {
    var asked = '';
    doc.addEventListener('prf:grid', function (ev) {
      var dt = (ev && ev.detail) || {}, st = dt.st || '';
      if (st === asked) return;
      asked = st;
      if (offer) offer.setAttribute('href', ST_RE.test(st) ? '/prf-sponsor?state=' + st : '/prf-sponsor');
      load().then(function (d) {
        if (asked !== st) return;
        var sp = pick(d, st, today());
        if (sp) show(box, sp, dt.stName || st, 'tool');
        else { box.hidden = true; box.innerHTML = ''; box.className = 'prf-spon'; box.removeAttribute('data-sponsor-slot'); }
        if (pbox) { pbox.innerHTML = sp ? renderPrint(sp) : ''; pbox.hidden = !sp; }
      });
    });
  }
})(this);
